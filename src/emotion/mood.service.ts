import { Injectable } from '@nestjs/common';
import { EmotionSnapshot } from './jiwen-emotion.service';

/**
 * AI 角色的情绪模型
 *
 * 模拟真实人类的情绪特征：
 * - 情绪不会突变（惯性）
 * - 情绪会衰减（回归中性）
 * - 受对方情绪影响（共鸣）
 * - 有随机波动（人不会永远一个状态）
 */
export interface MoodState {
  /** 愉悦度 0~1（0=低落, 0.5=中性, 1=开心） */
  valence: number;
  /** 活跃度 0~1（0=疲惫安静, 0.5=正常, 1=兴奋话多） */
  arousal: number;
  /** 当前情绪标签 */
  label: string;
  /** 本次会话的情绪曲线（最近 5 次状态） */
  recent: string[];
}

/**
 * AI 情绪服务
 *
 * 维护 AI 角色自身的情绪状态，让它不再只是"分析用户情绪"，
 * 而是像一个真人一样有自己的情绪波动。
 *
 * 每个会话维护独立的情绪状态。
 */
@Injectable()
export class MoodService {
  private readonly moods = new Map<string, MoodState>();

  /** 初始化/获取会话的情绪状态 */
  getOrCreate(sessionId: string): MoodState {
    if (!this.moods.has(sessionId)) {
      this.moods.set(sessionId, {
        valence: 0.55 + Math.random() * 0.1, // 初始略微偏积极（0.55~0.65）
        arousal: 0.45 + Math.random() * 0.1, // 初始正常偏安静（0.45~0.55）
        label: '平静',
        recent: ['平静'],
      });
    }
    return this.moods.get(sessionId)!;
  }

  /**
   * 根据用户情绪更新 AI 的情绪状态
   *
   * 规则：
   * - 共鸣：用户开心 AI 也会变开心一点（valence 上升）
   * - 衰减：情绪会逐步回归中性
   * - 惯性：不会突变，每次只变化一小步
   */
  update(sessionId: string, userEmotion: EmotionSnapshot | null): MoodState {
    const mood = this.getOrCreate(sessionId);

    if (userEmotion) {
      // 共鸣：AI 的情绪向用户情绪靠近一小步
      const userValence = userEmotion.valence ?? 0.5;
      const userArousal = userEmotion.arousal ?? 0.5;

      // 情绪共鸣系数：越强烈的情绪，共鸣越强
      const intensity = Math.abs(userValence - 0.5) * 2; // 0~1
      const empathy = 0.15 + intensity * 0.2; // 0.15~0.35

      mood.valence = this.lerp(mood.valence, userValence, empathy);
      mood.arousal = this.lerp(mood.arousal, userArousal, empathy);
    }

    // 自然衰减：情绪向中性回归
    mood.valence = this.lerp(mood.valence, 0.5, 0.05);
    mood.arousal = this.lerp(mood.arousal, 0.5, 0.03);

    // 微小随机波动（±0.03）
    mood.valence += (Math.random() - 0.5) * 0.06;
    mood.arousal += (Math.random() - 0.5) * 0.06;

    // clamp
    mood.valence = Math.max(0.05, Math.min(0.95, mood.valence));
    mood.arousal = Math.max(0.05, Math.min(0.95, mood.arousal));

    // 更新标签
    mood.label = this.toLabel(mood.valence, mood.arousal);
    mood.recent.push(mood.label);
    if (mood.recent.length > 5) mood.recent.shift();

    return mood;
  }

  /** 生成 AI 当前情绪对回复风格的影响说明 */
  summarize(mood: MoodState): string | null {
    const { label, valence, arousal } = mood;

    const toneMap: Record<string, string> = {
      开心: '用轻松活泼的语气回应，可以多笑、多发感叹号',
      温暖: '语气温柔关切，像在说"我在呢"',
      平静: '自然平和的语气，像日常闲聊',
      疲惫: '语气稍缓，不那么热情但也别冷淡，像累了但还在陪你',
      低落: '语气温柔但不过分活泼，真诚地表达关心',
      兴奋: '话可以多一点，用感叹号和表情表达兴奋',
      烦躁: '语气可以稍显不耐烦但别过头，像朋友吐槽一样',
      困倦: '语气慵懒、话少一点，可能会打哈欠或说困',
    };

    const tone = toneMap[label] ?? '自然随意的语气';

    const lines = [
      `【你当前的情绪状态】`,
      `你现在的感受：${label}（愉悦度 ${(valence * 100).toFixed(0)}%，活跃度 ${(arousal * 100).toFixed(0)}%）`,
      `你要这样回应：${tone}`,
      ``,
      `重要：你是一个有情绪的真实人类。你的情绪会自然流露在回复中，`,
      `但不要主动说"我现在很xxx"之类的话。让情绪通过语气自然流露，而不是直接说出来。`,
    ];

    return lines.join('\n');
  }

  /** 清理会话状态（会话删除时调用） */
  clear(sessionId: string) {
    this.moods.delete(sessionId);
  }

  // ═══ helpers ═══

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  private toLabel(valence: number, arousal: number): string {
    // 二维情绪空间 → 标签
    if (valence > 0.62 && arousal > 0.55) return '开心';
    if (valence > 0.62 && arousal <= 0.55) return '温暖';
    if (valence < 0.38 && arousal > 0.55) return '烦躁';
    if (valence < 0.38 && arousal <= 0.55) return '低落';
    if (arousal > 0.62) return '兴奋';
    if (arousal < 0.33) return '困倦';
    return '平静';
  }
}
