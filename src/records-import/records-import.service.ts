import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Character } from '../characters/entities/character.entity';
import { Message, MessageRole } from '../messages/entities/message.entity';
import { CreateMessageInput, MessagesService } from '../messages/messages.service';
import { ImportProfile } from '../sessions/entities/session.entity';
import { SessionsService } from '../sessions/sessions.service';
import { MemoriesService, MemoryType } from '../memories/memories.service';
import { LlmService } from '../llm/llm.service';
import { JiwenEmotionService } from '../emotion/jiwen-emotion.service';

export interface ImportChatRecordsDto {
  sessionId: string;
  text: string;
  userAliases?: string[];
  assistantAliases?: string[];
  unknownSpeakerRole?: MessageRole;
  triggerMemoryExtraction?: boolean;
  generateSummary?: boolean;
  extractProfile?: boolean;
  /** 角色设定模式：'replace' 完全重写 | 'merge' 保留手动设定+追加风格（默认） */
  mode?: 'replace' | 'merge';
}

interface ParsedRecord {
  speaker: string;
  role: MessageRole;
  content: string;
}

interface PendingBlock {
  speaker: string;
  role: MessageRole;
  lines: string[];
}

export interface ImportChatRecordsResult {
  sessionId: string;
  parsed: number;
  inserted: number;
  memoryExtractionQueued: boolean;
  summaryQueued: boolean;
  profileExtractionQueued: boolean;
  preview: ParsedRecord[];
}

@Injectable()
export class RecordsImportService {
  constructor(
    @InjectRepository(Character)
    private readonly characterRepo: Repository<Character>,
    private readonly sessionsService: SessionsService,
    private readonly messagesService: MessagesService,
    private readonly memoriesService: MemoriesService,
    private readonly llmService: LlmService,
    private readonly jiwenEmotionService: JiwenEmotionService,
  ) {}

  async importChatRecords(dto: ImportChatRecordsDto): Promise<ImportChatRecordsResult> {
    await this.sessionsService.findOne(dto.sessionId);

    const parsed = this.parse(dto);
    const messageInputs: CreateMessageInput[] = parsed.map((record) => ({
      sessionId: dto.sessionId,
      role: record.role,
      content: record.content,
      emotionSnapshot:
        record.role === 'user'
          ? this.jiwenEmotionService.analyze(record.content)
          : null,
    }));

    const saved =
      messageInputs.length > 0
        ? await this.messagesService.createMany(messageInputs)
        : [];

    if (saved.length > 0) {
      await this.sessionsService.incrementMessageCount(dto.sessionId, saved.length);
    }

    const memoryExtractionQueued =
      (dto.triggerMemoryExtraction ?? true) && saved.length > 0;
    const summaryQueued = (dto.generateSummary ?? true) && saved.length > 0;
    const profileExtractionQueued = (dto.extractProfile ?? true) && saved.length > 0;

    if (memoryExtractionQueued) {
      setImmediate(() => {
        this.extractMemoriesFromImported(dto.sessionId, saved).catch((err: Error) => {
          console.error('[Import Memory Extract]', err.message);
        });
      });
    }

    if (summaryQueued) {
      setImmediate(() => {
        this.generateImportedSummary(dto.sessionId, saved).catch((err: Error) => {
          console.error('[Import Summary]', err.message);
        });
      });
    }

    if (profileExtractionQueued) {
      setImmediate(() => {
        this.extractProfileFromImported(dto.sessionId, saved).catch((err: Error) => {
          console.error('[Import Profile Extract]', err.message);
        });
      });
      // 同时提取角色说话风格
      setImmediate(() => {
        // 默认 merge：保留手动设定，从记录中追加说话风格
        this.enrichCharacterProfile(dto.sessionId, dto.mode ?? 'merge').catch((err: Error) => {
          console.error('[Enrich Character]', err.message);
        });
      });
    }

    return {
      sessionId: dto.sessionId,
      parsed: parsed.length,
      inserted: saved.length,
      memoryExtractionQueued,
      summaryQueued,
      profileExtractionQueued,
      preview: parsed.slice(0, 5),
    };
  }

  parse(dto: ImportChatRecordsDto): ParsedRecord[] {
    const userAliases = new Set(
      ['我', '用户', 'user', 'me', '自己', '本人', ...(dto.userAliases ?? [])].map((name) =>
        name.toLowerCase(),
      ),
    );
    const assistantAliases = new Set(
      ['ai', 'assistant', 'bot', '机器人', '小雅', '系统', ...(dto.assistantAliases ?? [])].map(
        (name) => name.toLowerCase(),
      ),
    );
    const unknownRole = dto.unknownSpeakerRole ?? 'user';
    const lines = dto.text.replace(/\r\n/g, '\n').split('\n');
    const records: ParsedRecord[] = [];
    let pending: PendingBlock | null = null;

    const flush = () => {
      if (!pending) return;
      const content = pending.lines.join('\n').trim();
      if (content) {
        records.push({ speaker: pending.speaker, role: pending.role, content });
      }
      pending = null;
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        if (pending && pending.lines.length > 0) pending.lines.push('');
        continue;
      }

      const header = this.matchWechatHeaderLine(line) ?? this.matchHeaderLine(line);
      if (header) {
        flush();
        pending = {
          speaker: header,
          role: this.resolveRole(header, userAliases, assistantAliases, unknownRole),
          lines: [],
        };
        continue;
      }

      const inline = this.matchInlineLine(line);
      if (inline) {
        flush();
        records.push({
          speaker: inline.speaker,
          role: this.resolveRole(inline.speaker, userAliases, assistantAliases, unknownRole),
          content: inline.content,
        });
        continue;
      }

      if (pending) {
        pending.lines.push(line);
      } else {
        records.push({ speaker: 'unknown', role: unknownRole, content: line });
      }
    }

    flush();
    return records.filter((record) => record.content.length > 0);
  }

  private matchWechatHeaderLine(line: string): string | null {
    const normalized = line.trim();

    const timeFirst = normalized.match(
      /^(?:\[)?\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?(?:\])?\s+(.{1,32})$/,
    );
    if (timeFirst) return timeFirst[1].trim();

    const speakerFirst = normalized.match(
      /^(.{1,32})\s+(?:\[)?\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?(?:\])?$/,
    );
    if (speakerFirst) return speakerFirst[1].trim();

    if (/^[-—\s]*\d{4}[-年]\d{1,2}[-月]\d{1,2}/.test(normalized)) return null;

    return null;
  }

  private matchInlineLine(line: string): { speaker: string; content: string } | null {
    const match = line.match(/^(?:\[[^\]]+\]\s*)?([^:：]{1,32})[:：]\s*(.+)$/);
    if (!match) return null;
    return { speaker: match[1].trim(), content: match[2].trim() };
  }

  private matchHeaderLine(line: string): string | null {
    const qqStyle = line.match(
      /^(.{1,32})\s+(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}:\d{2})(?:\s|$)/,
    );
    if (qqStyle) return qqStyle[1].trim();

    const wechatStyle = line.match(
      /^(.{1,32})\s+(?:\d{1,2}:\d{2}|\d{4}年\d{1,2}月\d{1,2}日)/,
    );
    if (wechatStyle) return wechatStyle[1].trim();

    return null;
  }

  private resolveRole(
    speaker: string,
    userAliases: Set<string>,
    assistantAliases: Set<string>,
    unknownRole: MessageRole,
  ): MessageRole {
    const normalized = speaker.trim().toLowerCase();
    if (userAliases.has(normalized)) return 'user';
    if (assistantAliases.has(normalized)) return 'assistant';
    return unknownRole;
  }

  private async extractMemoriesFromImported(sessionId: string, messages: Message[]) {
    if (messages.length === 0) return;

    for (const chunk of this.chunk(messages, 20)) {
      const transcript = this.toTranscript(chunk);

      const prompt = `从以下导入的聊天记录中提取关于用户的长期事实、偏好或情绪模式。
每条一行，格式：[类型] 内容。没有值得提取的信息就输出"无"。

类型说明：
[事实] - 稳定客观信息
[偏好] - 喜好、习惯、讨厌的事
[情绪] - 长期情绪模式或最近反复出现的状态

聊天记录：
${transcript}

提取结果：`;

      const result = await this.llmService.chat(
        [{ role: 'user', content: prompt }],
        { temperature: 0.3, maxTokens: 700 },
      );

      if (!result || result.trim() === '无') continue;

      const sourceMsgId = chunk.find((message) => message.role === 'user')?.id ?? chunk[0].id;
      for (const line of result.split('\n').filter((item) => item.trim())) {
        const match = line.match(/^\[(事实|偏好|情绪)\]\s*(.+)$/);
        if (!match) continue;
        const typeMap: Record<string, MemoryType> = {
          事实: 'fact',
          偏好: 'preference',
          情绪: 'emotion',
        };
        await this.memoriesService.addMemoryByText(
          sessionId,
          match[2].trim(),
          typeMap[match[1]],
          sourceMsgId,
        );
      }
    }
  }

  private async generateImportedSummary(sessionId: string, messages: Message[]) {
    if (messages.length === 0) return;
    const recent = messages.slice(-80);
    const transcript = this.toTranscript(recent);

    const prompt = `请把以下导入的聊天记录压缩成一段可用于长期上下文的摘要。
重点关注：用户身份信息、关系状态、长期偏好、反复出现的情绪、近期重要事件。

聊天记录：
${transcript}

摘要：`;

    const summary = await this.llmService.chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0.4, maxTokens: 700 },
    );

    if (summary?.trim()) {
      await this.sessionsService.updateSummary(sessionId, summary.trim());
    }
  }

  private async extractProfileFromImported(sessionId: string, messages: Message[]) {
    if (messages.length === 0) return;

    const transcript = this.toTranscript(messages.slice(-160));
    const prompt = `你要从导入的聊天记录中提取长期人格画像和关系画像。
只输出 JSON，不要输出解释、Markdown 或额外文本。

JSON schema:
{
  "userPersona": {
    "stableFacts": ["稳定客观事实"],
    "preferences": ["长期偏好、习惯、讨厌的事"],
    "communicationStyle": ["表达风格、常用语气、沟通节奏"],
    "emotionalPatterns": ["反复出现的情绪模式"],
    "boundaries": ["用户明确或隐含的边界、禁忌、需要避免的方式"]
  },
  "relationshipProfile": {
    "relationshipTone": "双方互动的整体语气",
    "closenessLevel": "low | medium | high",
    "trustSignals": ["信任、依赖、亲近或疏离的证据"],
    "recurringTopics": ["反复出现的话题"],
    "supportNeeds": ["用户希望 AI 提供的支持方式"],
    "assistantRole": "AI 在这段关系中更像什么角色"
  },
  "evidence": {
    "source": "import",
    "messageCount": ${messages.length},
    "generatedAt": "${new Date().toISOString()}"
  }
}

要求：
- 只保留聊天记录能支持的内容，不要编造。
- 数组最多 8 条，每条尽量短。
- 如果证据不足，对应数组用 []，字符串用 ""。

聊天记录：
${transcript}

JSON：`;

    const raw = await this.llmService.chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0.2, maxTokens: 1200 },
    );

    const profile = this.parseImportProfile(raw, messages.length);
    if (!profile) return;

    await this.sessionsService.updateImportProfile(sessionId, profile);
    await this.addProfileMemories(sessionId, profile, messages);
  }

  private parseImportProfile(raw: string | null | undefined, messageCount: number): ImportProfile | null {
    if (!raw?.trim()) return null;

    const jsonText = this.extractJsonText(raw);
    if (!jsonText) return null;

    try {
      const parsed = JSON.parse(jsonText) as ImportProfile;
      return {
        userPersona: {
          stableFacts: this.toStringArray(parsed.userPersona?.stableFacts),
          preferences: this.toStringArray(parsed.userPersona?.preferences),
          communicationStyle: this.toStringArray(parsed.userPersona?.communicationStyle),
          emotionalPatterns: this.toStringArray(parsed.userPersona?.emotionalPatterns),
          boundaries: this.toStringArray(parsed.userPersona?.boundaries),
        },
        relationshipProfile: {
          relationshipTone: this.toStringValue(parsed.relationshipProfile?.relationshipTone),
          closenessLevel: this.normalizeCloseness(parsed.relationshipProfile?.closenessLevel),
          trustSignals: this.toStringArray(parsed.relationshipProfile?.trustSignals),
          recurringTopics: this.toStringArray(parsed.relationshipProfile?.recurringTopics),
          supportNeeds: this.toStringArray(parsed.relationshipProfile?.supportNeeds),
          assistantRole: this.toStringValue(parsed.relationshipProfile?.assistantRole),
        },
        evidence: {
          source: 'import',
          messageCount,
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (err) {
      console.error('[Import Profile Parse]', (err as Error).message);
      return null;
    }
  }

  private extractJsonText(raw: string): string | null {
    const fenced = raw.match(/\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`/i);
    if (fenced) return fenced[1].trim();

    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) return null;
    return raw.slice(first, last + 1).trim();
  }

  private async addProfileMemories(
    sessionId: string,
    profile: ImportProfile,
    messages: Message[],
  ) {
    const sourceMsgId = messages.find((message) => message.role === 'user')?.id ?? messages[0]?.id;
    if (!sourceMsgId) return;

    const entries: { content: string; type: MemoryType }[] = [];
    for (const item of profile.userPersona?.stableFacts ?? []) {
      entries.push({ content: item, type: 'fact' });
    }
    for (const item of [
      ...(profile.userPersona?.preferences ?? []),
      ...(profile.userPersona?.boundaries ?? []),
      ...(profile.relationshipProfile?.supportNeeds ?? []),
    ]) {
      entries.push({ content: item, type: 'preference' });
    }
    for (const item of [
      ...(profile.userPersona?.emotionalPatterns ?? []),
      profile.relationshipProfile?.relationshipTone,
    ]) {
      if (item) entries.push({ content: item, type: 'emotion' });
    }

    for (const entry of entries.slice(0, 24)) {
      await this.memoriesService.addMemoryByText(
        sessionId,
        entry.content,
        entry.type,
        sourceMsgId,
      );
    }
  }

  private toTranscript(messages: Message[]) {
    return messages
      .map((message) => `${message.role === 'user' ? '用户' : 'AI'}：${message.content}`)
      .join('\n');
  }

  private toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  private toStringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private normalizeCloseness(value: unknown): 'low' | 'medium' | 'high' | '' {
    if (value === 'low' || value === 'medium' || value === 'high') return value;
    return '';
  }

  /**
   * 从导入的聊天记录中提取角色的说话风格，更新 character.base_prompt
   *
   * 和 extractProfileFromImported 不同：
   *   - extractProfileFromImported 分析 USER → 存到 session.import_profile（用户画像）
   *   - enrichCharacterProfile 分析 ASSISTANT → 更新 character.base_prompt（角色设定）
   */
  async enrichCharacterProfile(
    sessionId: string,
    mode: 'replace' | 'merge' = 'replace',
  ): Promise<{
    characterId: string;
    generatedPrompt: string | null;
    speechPatterns: Record<string, any>;
  } | null> {
    const session = await this.sessionsService.findOne(sessionId);
    const character = await this.characterRepo.findOne({
      where: { id: session.characterId },
    });
    if (!character) throw new Error('角色不存在');

    // 取 assistant 的消息（最多 200 条）
    const assistantMsgs = await this.messagesService.findByRole(sessionId, 'assistant', 200);
    if (assistantMsgs.length < 5) {
      console.log('[Enrich Character] 角色发言不足 5 条，跳过');
      return null;
    }

    const samples = assistantMsgs
      .map((m) => m.content)
      .filter((c) => c.length >= 5)
      .slice(0, 80);

    const transcript = samples.map((c, i) => `${i + 1}. ${c}`).join('\n');

    const prompt = `你需要从以下聊天记录中还原"${character.name}"这个人的完整人格和说话方式。

注意：这里的"${character.name}"是 AI 需要扮演的角色。你需要从 TA 的发言中提取 TA 是怎么说话、什么性格、有什么习惯。

请生成一个完整的角色人设 JSON（只输出 JSON）：

{
  "basePrompt": "【角色设定】\\n...(从记录中推断 TA 的年龄、身份、性格，用第三人称写)\\n\\n【说话风格】\\n- 语气风格（轻松/温柔/活泼/冷静...）\\n- 句尾习惯（常用什么语气词：呢/呀/嘛/啦...）\\n- 聊天节奏（爱反问/爱分享/话多/话少）\\n- 表达特点（爱用叠词/爱吐槽/爱玩梗...）\\n- 常见的口语习惯和口头禅\\n\\n【情感表达】\\n- 开心时怎么说话\\n- 安慰人时怎么说话\\n- 生气或低落时怎么说话\\n\\n【聊天风格总结】\\n一段概括 TA 聊天方式的描述，包含模仿 TA 语气的示例对话",
  "speechPatterns": {
    "sentenceEndings": ["常用的句尾语气词"],
    "catchphrases": ["高频口头禅"],
    "emojiStyle": ["常用表情/符号"],
    "avgLength": "short | medium | long",
    "tone": "温柔 | 活泼 | 幽默 | 冷淡 | 理性 | 傲娇 | 元气",
    "questionFrequency": "经常反问 | 偶尔反问 | 基本不问",
    "selfDisclosure": "经常分享 | 偶尔分享 | 很少分享"
  }
}

要求：
- basePrompt 要完整、可直接用作角色人设，200-500 字
- 只从聊天记录中提取，不要编造
- 示例对话里要体现 TA 的真实说话方式
- 如果记录中 TA 有特定的口癖/梗/惯用表达，一定要写进说话风格
- 写成"扮演指南"的风格——让人看了就知道怎么模仿 TA 说话

分析材料（${character.name}的发言，共 ${samples.length} 条）：
${transcript}`;

    const raw = await this.llmService.chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0.2, maxTokens: 1500 },
    );

    let parsed: Record<string, any>;
    try {
      const jsonText = this.extractJsonText(raw);
      if (!jsonText) throw new Error('No JSON found');
      parsed = JSON.parse(jsonText);
    } catch {
      console.error('[Enrich Character] JSON 解析失败:', raw.substring(0, 200));
      return null;
    }

    // --- 应用生成的设定 ---
    const generatedPrompt = parsed?.basePrompt;
    const patterns = parsed?.speechPatterns;

    if (mode === 'replace') {
      // 模式 1：完全替换 —— 用聊天记录生成完整人设
      if (generatedPrompt && typeof generatedPrompt === 'string' && generatedPrompt.length >= 30) {
        await this.characterRepo.update(character.id, {
          basePrompt: generatedPrompt,
        } as any);
        console.log(`[Enrich Character] ${character.name} 人设已自动生成（${generatedPrompt.length}字）`);
      }
    } else {
      // 模式 2：合并 —— 保留手动设定，追加从记录分析出的风格
      const tone = patterns?.tone;
      const endings = patterns?.sentenceEndings?.join('、');
      const catchphrases = patterns?.catchphrases?.join('、');
      const styleLines: string[] = [];
      if (tone) styleLines.push(`- 语气基调：${tone}`);
      if (endings) styleLines.push(`- 常用句尾：${endings}`);
      if (catchphrases) styleLines.push(`- 口头禅：${catchphrases}`);
      if (patterns?.avgLength) styleLines.push(`- 回复长度：${patterns.avgLength}`);

      if (styleLines.length > 0) {
        const current = character.basePrompt || '';
        // 移除旧的自动提取部分，追加新的
        const cleaned = current.replace(/\n\n【从聊天记录提取的说话风格】[\s\S]*$/, '');
        const merged = cleaned + '\n\n【从聊天记录提取的说话风格】\n' + styleLines.join('\n');
        await this.characterRepo.update(character.id, {
          basePrompt: merged,
        } as any);
        console.log(`[Enrich Character] ${character.name} 手动设定已保留，风格已追加`);
      }
    }

    // speech_patterns 始终更新
    if (patterns && typeof patterns === 'object') {
      await this.characterRepo.update(character.id, {
        speechPatterns: patterns,
      } as any);
    }

    return {
      characterId: character.id,
      generatedPrompt: generatedPrompt || null,
      speechPatterns: patterns || {},
    };
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      result.push(items.slice(index, index + size));
    }
    return result;
  }
}
