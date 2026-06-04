import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Observable } from 'rxjs';
import { Character } from '../characters/entities/character.entity';
import { SessionsService } from '../sessions/sessions.service';
import { MessagesService } from '../messages/messages.service';
import { MemoriesService, MemoryType } from '../memories/memories.service';
import { LlmService, ChatMessage } from '../llm/llm.service';
import { JiwenEmotionService } from '../emotion/jiwen-emotion.service';

/**
 * 聊天服务 —— 核心业务编排（Day 6 完整版）
 *
 * 完整流程（同步 + 异步）：
 *  1. 保存用户消息 ───────────────────────── 同步
 *  2. 读取上下文 ─────────────────────────── 同步
 *  3. 向量检索相关记忆 → prompt 第三层 ───── 同步
 *  4. 组装 system prompt（四层叠加）─────── 同步
 *  5. 调 DeepSeek → 生成回复 ────────────── 同步
 *  6. 保存 AI 回复 ──────────────────────── 同步
 *  7. 更新消息计数 ──────────────────────── 同步
 *  8. 返回 reply ────────────────────────── 同步
 *         │
 *         └→ 9. [异步] 记忆提取（setImmediate）─── Day 6
 *           10. [异步] 滚动摘要检查（setImmediate）─ Day 6
 */
@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Character)
    private readonly characterRepo: Repository<Character>,
    private readonly sessionsService: SessionsService,
    private readonly messagesService: MessagesService,
    private readonly memoriesService: MemoriesService,
    private readonly llmService: LlmService,
    private readonly jiwenEmotionService: JiwenEmotionService,
  ) {}

  async handleMessage(sessionId: string, userContent: string) {
    // ════ 同步部分（用户等待） ════

    const userEmotion = this.jiwenEmotionService.analyze(userContent);
    const userMsg = await this.messagesService.create(
      sessionId,
      'user',
      userContent,
      userEmotion,
    );

    const session = await this.sessionsService.findOne(sessionId);
    const character = await this.characterRepo.findOne({
      where: { id: session.characterId },
    });
    if (!character) {
      throw new Error(`角色 "${session.characterId}" 不存在`);
    }

    const recentMessages = await this.messagesService.findRecent(sessionId, 10);

    // 向量检索记忆
    let memories: { content: string }[] = [];
    try {
      memories = await this.memoriesService.searchByText(
        sessionId,
        userContent,
        5,
      );
    } catch (err) {
      console.error('[Memory Search]', (err as Error).message);
    }

    // 组装 prompt + 调 LLM
    const systemPrompt = this.buildSystemPrompt(
      character,
      session.summary,
      session.importProfile,
      memories,
      this.jiwenEmotionService.summarize(userEmotion),
    );
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...recentMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content: userContent },
    ];

    const assistantContent = await this.llmService.chat(messages);

    await this.messagesService.create(sessionId, 'assistant', assistantContent);
    await this.sessionsService.incrementMessageCount(sessionId, 2);

    // ════ 异步部分（不阻塞用户） ════

    // 记忆提取：从对话中提取事实/偏好/情绪碎片
    setImmediate(() => {
      this.extractMemory(sessionId, userContent, assistantContent, userMsg.id);
    });

    // 滚动摘要：每 50 条检查一次
    setImmediate(() => {
      this.checkAndSummarize(sessionId);
    });

    return { reply: assistantContent };
  }

  // ═══════════════════════════════════════════════════════════════
  //  流式对话（SSE）
  // ═══════════════════════════════════════════════════════════════

  /**
   * 流式处理用户消息，返回 Observable<string>
   *
   * 和 handleMessage 逻辑相同，但返回的是 Observable。
   * 每个 text chunk 立即推送给前端，不需要等完整回复。
   *
   * 流程：
   *  1-3. 同步：保存消息 + 读上下文 + 检索记忆
   *  4. 返回 Observable（流式推送 AI 回复）
   *  5. 流结束后异步保存 AI 回复 + 更新计数 + 触发记忆提取
   */
  handleMessageStream(
    sessionId: string,
    userContent: string,
  ): Observable<string> {
    return new Observable<string>((subscriber) => {
      // 用立即执行的 async 函数包装
      (async () => {
        try {
          // 1. 保存用户消息
          const userEmotion = this.jiwenEmotionService.analyze(userContent);
          const userMsg = await this.messagesService.create(
            sessionId,
            'user',
            userContent,
            userEmotion,
          );

          // 2. 读上下文
          const session = await this.sessionsService.findOne(sessionId);
          const character = await this.characterRepo.findOne({
            where: { id: session.characterId },
          });
          if (!character) throw new Error(`角色不存在`);

          const recentMessages = await this.messagesService.findRecent(
            sessionId,
            10,
          );

          // 3. 检索记忆
          let memories: { content: string }[] = [];
          try {
            memories = await this.memoriesService.searchByText(
              sessionId,
              userContent,
              5,
            );
          } catch (err) {
            console.error('[Memory Search]', (err as Error).message);
          }

          // 4. 组装 prompt
          const systemPrompt = this.buildSystemPrompt(
            character,
            session.summary,
            session.importProfile,
            memories,
            this.jiwenEmotionService.summarize(userEmotion),
          );
          const messages: ChatMessage[] = [
            { role: 'system', content: systemPrompt },
            ...recentMessages.map((m) => ({
              role: m.role as 'user' | 'assistant',
              content: m.content,
            })),
            { role: 'user', content: userContent },
          ];

          // 5. 流式调 LLM，逐 chunk 推送给前端
          let fullReply = '';
          const stream$ = this.llmService.chatStream(messages);

          stream$.subscribe({
            next: (chunk: string) => {
              fullReply += chunk;
              subscriber.next(chunk); // ← 立即推送给前端
            },
            error: (err: Error) => {
              subscriber.error(err);
            },
            complete: async () => {
              // 流结束后：保存完整回复 + 更新计数
              await this.messagesService.create(
                sessionId,
                'assistant',
                fullReply,
              );
              await this.sessionsService.incrementMessageCount(sessionId, 2);

              // 异步提取记忆
              setImmediate(() => {
                this.extractMemory(
                  sessionId,
                  userContent,
                  fullReply,
                  userMsg.id,
                );
                this.checkAndSummarize(sessionId);
              });

              subscriber.complete();
            },
          });
        } catch (err) {
          subscriber.error(err);
        }
      })();
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  异步记忆提取
  // ═══════════════════════════════════════════════════════════════

  /**
   * 从一轮对话中提取记忆碎片
   *
   * 流程：
   *  1. 调 DeepSeek（轻量 prompt）提取事实/偏好/情绪
   *  2. 解析 LLM 返回的每行 → [类型] 内容
   *  3. 逐条向量化（Python 服务）
   *  4. 查重（cosine > 0.95 跳过）
   *  5. 写入 memory_chunks
   *
   * 异步执行，失败不影响主流程。
   */
  private async extractMemory(
    sessionId: string,
    userMsg: string,
    assistantMsg: string,
    sourceMsgId: number,
  ) {
    try {
      // 1. 调 LLM 提取
      const prompt = `从以下对话中提取关于用户的事实、偏好或情绪碎片。
每条一行，格式：[类型] 内容。没有值得提取的信息就输出"无"。

类型说明：
  [事实] - 客观信息（居住地、职业、年龄、经历等）
  [偏好] - 喜好和习惯（喜欢什么、讨厌什么、习惯做什么）
  [情绪] - 情绪状态（开心、焦虑、疲惫、期待等）

对话：
用户：${userMsg}
AI：${assistantMsg}

提取结果：`;

      const result = await this.llmService.chat(
        [{ role: 'user', content: prompt }],
        {
          temperature: 0.3, // 低温：提取任务需要准确性而非创造性
          maxTokens: 500,
        },
      );

      if (!result || result.trim() === '无') return;

      // 2. 逐行解析
      const lines = result.split('\n').filter((l) => l.trim());
      const typeMap: Record<string, MemoryType> = {
        事实: 'fact',
        偏好: 'preference',
        情绪: 'emotion',
      };

      for (const line of lines) {
        const match = line.match(/^\[(事实|偏好|情绪)\]\s*(.+)$/);
        if (!match) continue;

        const [, typeLabel, content] = match;
        const memoryType = typeMap[typeLabel];
        if (!content || content.trim().length === 0) continue;

        // 3+4+5: 向量化 → 查重 → 写入
        const added = await this.memoriesService.addMemoryByText(
          sessionId,
          content.trim(),
          memoryType,
          sourceMsgId,
        );

        if (added) {
          console.log(`[Memory] ${typeLabel}: ${content.trim()}`);
        } else {
          console.log(`[Memory] (重复跳过) ${content.trim()}`);
        }
      }
    } catch (err) {
      // 异步任务失败不抛异常，只打印日志
      console.error('[Memory Extract]', (err as Error).message);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  异步滚动摘要
  // ═══════════════════════════════════════════════════════════════

  /**
   * 检查是否需要生成滚动摘要
   *
   * 触发条件：
   *  - 消息数 >= 50 条
   *  - 距离上次摘要 >= 1 小时（用 last_summary_at 判断）
   *
   * 流程：
   *  1. 读取最近 50 条消息
   *  2. 拼成对话文本
   *  3. 调 DeepSeek：压缩成一段摘要
   *  4. 更新 session.summary，重置 message_count
   */
  private async checkAndSummarize(sessionId: string) {
    try {
      const session = await this.sessionsService.findOne(sessionId);

      // 条件 1：消息数 >= 50
      if (session.messageCount < 50) return;

      // 条件 2：距离上次摘要 >= 1 小时。不能用 updatedAt，聊天本身会刷新它。
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      if (session.lastSummaryAt && session.lastSummaryAt > oneHourAgo) return;

      console.log(`[Summarize] 开始为会话 ${sessionId} 生成摘要...`);

      // 读取最近 50 条
      const messages = await this.messagesService.findRecent(sessionId, 50);
      const conversation = messages
        .map((m) => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`)
        .join('\n');

      // 调 LLM 生成摘要
      const prompt = `请用一段话总结以下对话的核心内容，重点关注用户的信息变化（如生活状态、情绪变化、新发生的事件等）：

${conversation}

摘要：`;

      const summary = await this.llmService.chat(
        [{ role: 'user', content: prompt }],
        {
          temperature: 0.5,
          maxTokens: 500,
        },
      );

      // 更新 session，并清零未摘要消息计数
      await this.sessionsService.markSummarized(sessionId, summary);
      console.log(`[Summarize] 摘要已生成 (${summary.length} 字符)`);
    } catch (err) {
      console.error('[Summarize]', (err as Error).message);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  System Prompt 组装
  // ═══════════════════════════════════════════════════════════════
  private formatImportProfile(profile: unknown): string | null {
    if (!profile || typeof profile !== 'object') return null;
    const data = profile as {
      userPersona?: {
        stableFacts?: string[];
        preferences?: string[];
        communicationStyle?: string[];
        emotionalPatterns?: string[];
        boundaries?: string[];
      };
      relationshipProfile?: {
        relationshipTone?: string;
        closenessLevel?: string;
        trustSignals?: string[];
        recurringTopics?: string[];
        supportNeeds?: string[];
        assistantRole?: string;
      };
    };

    const lines: string[] = [];
    const addList = (label: string, values?: string[]) => {
      const items = Array.isArray(values) ? values.filter(Boolean).slice(0, 5) : [];
      if (items.length > 0) lines.push(`${label}：${items.join('；')}`);
    };

    addList('稳定事实', data.userPersona?.stableFacts);
    addList('长期偏好', data.userPersona?.preferences);
    addList('表达风格', data.userPersona?.communicationStyle);
    addList('情绪模式', data.userPersona?.emotionalPatterns);
    addList('边界', data.userPersona?.boundaries);

    const relationship = data.relationshipProfile;
    if (relationship?.relationshipTone) lines.push(`关系语气：${relationship.relationshipTone}`);
    if (relationship?.closenessLevel) lines.push(`亲密度：${relationship.closenessLevel}`);
    addList('信任信号', relationship?.trustSignals);
    addList('反复话题', relationship?.recurringTopics);
    addList('支持需求', relationship?.supportNeeds);
    if (relationship?.assistantRole) lines.push(`AI 角色：${relationship.assistantRole}`);

    return lines.length > 0 ? lines.join('\n') : null;
  }



  private buildSystemPrompt(
    character: { basePrompt: string; name: string },
    summary: string | null,
    importProfile: unknown,
    memories: { content: string }[],
    emotionSummary?: string | null,
  ): string {
    const parts: string[] = [
      // 第一层：固定人格
      character.basePrompt,
    ];

    // 第二层：滚动摘要 ✅ Day 6
    if (summary) {
      parts.push(`【你们之前的对话摘要】\n${summary}`);
    }


    const profileSummary = this.formatImportProfile(importProfile);
    if (profileSummary) {
      parts.push(`【长期人格/关系画像】\n${profileSummary}`);
    }

    // 第三层：动态记忆 ✅ Day 5
    if (memories.length > 0) {
      const memoryLines = memories.map((m) => `- ${m.content}`).join('\n');
      parts.push(`【关于用户的记忆】\n${memoryLines}`);
    }

    // 第四层：当前情绪状态 ✅ jiwen
    if (emotionSummary) {
      parts.push(`【jiwen 情绪状态】\n${emotionSummary}`);
    }

    // 第五层：指令约束
    parts.push(
      '请记住以上信息，用符合你性格的方式回复。保持角色一致性，不要跳出人设。',
    );

    return parts.filter(Boolean).join('\n\n');
  }
}

