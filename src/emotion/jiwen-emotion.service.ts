import { Injectable } from '@nestjs/common';

export interface EmotionSnapshot {
  [key: string]: number | string;
  dominant: string;
  valence: number;
  arousal: number;
}

interface WeightedLexicon {
  score: EmotionKey;
  words: string[];
  weight: number;
}

const LEXICON: WeightedLexicon[] = [
  { score: 'joy', weight: 0.32, words: ['开心', '高兴', '快乐', '惊喜', '期待', '喜欢', '舒服', '放松', '太好了', '好耶'] },
  { score: 'sadness', weight: 0.34, words: ['难过', '伤心', '失落', '委屈', '想哭', '崩溃', '低落', '孤单', '孤独'] },
  { score: 'anger', weight: 0.34, words: ['生气', '愤怒', '烦死', '气死', '讨厌', '火大', '不爽', '恼火'] },
  { score: 'anxiety', weight: 0.34, words: ['焦虑', '紧张', '担心', '害怕', '慌', '不安', '压力', '压力大', '怎么办'] },
  { score: 'fatigue', weight: 0.34, words: ['累', '疲惫', '困', '没力气', '熬夜', '加班', '撑不住', '好累'] },
  { score: 'stress', weight: 0.32, words: ['忙', '赶', 'ddl', 'deadline', '来不及', '压得', '任务好多', '好多事'] },
  { score: 'affection', weight: 0.3, words: ['想你', '在乎', '陪我', '抱抱', '谢谢你', '喜欢你', '需要你'] },
];

const EMOTION_KEYS = ['joy', 'sadness', 'anger', 'anxiety', 'fatigue', 'stress', 'affection'] as const;

type EmotionKey = (typeof EMOTION_KEYS)[number];

@Injectable()
export class JiwenEmotionService {
  analyze(text: string): EmotionSnapshot {
    const normalized = text.toLowerCase();
    const scores = Object.fromEntries(EMOTION_KEYS.map((key) => [key, 0])) as Record<EmotionKey, number>;

    for (const item of LEXICON) {
      for (const word of item.words) {
        if (normalized.includes(word.toLowerCase())) {
          scores[item.score] = Math.min(1, scores[item.score] + item.weight);
        }
      }
    }

    if (/[!！]{2,}/.test(text)) {
      scores.joy = Math.min(1, scores.joy + 0.08);
      scores.anger = Math.min(1, scores.anger + 0.08);
      scores.anxiety = Math.min(1, scores.anxiety + 0.05);
    }
    if (/[?？]{2,}/.test(text)) {
      scores.anxiety = Math.min(1, scores.anxiety + 0.08);
    }
    if (/哈{2,}|嘿嘿|哈哈/.test(text)) {
      scores.joy = Math.min(1, scores.joy + 0.18);
    }
    if (/唉|哎|唔|呜|T_T|😭|😢/.test(text)) {
      scores.sadness = Math.min(1, scores.sadness + 0.18);
    }

    const dominantEntry = EMOTION_KEYS
      .map((key) => [key, scores[key]] as const)
      .sort((a, b) => b[1] - a[1])[0];
    const dominant = dominantEntry[1] >= 0.18 ? dominantEntry[0] : 'neutral';

    const positive = scores.joy + scores.affection * 0.8;
    const negative = scores.sadness + scores.anger + scores.anxiety + scores.fatigue * 0.8 + scores.stress * 0.6;
    const valence = this.clamp01(0.5 + positive * 0.35 - negative * 0.22);
    const arousal = this.clamp01(0.25 + scores.anger * 0.38 + scores.anxiety * 0.35 + scores.joy * 0.22 + scores.stress * 0.26 + scores.fatigue * 0.12);

    return {
      ...scores,
      neutral: dominant === 'neutral' ? 1 : 0,
      dominant,
      valence: Number(valence.toFixed(3)),
      arousal: Number(arousal.toFixed(3)),
    };
  }

  summarize(snapshot: EmotionSnapshot | null | undefined): string | null {
    if (!snapshot) return null;
    const label = this.label(snapshot.dominant);
    const valence = snapshot.valence >= 0.62 ? '偏积极' : snapshot.valence <= 0.42 ? '偏消极' : '平稳';
    const arousal = snapshot.arousal >= 0.62 ? '较强烈' : snapshot.arousal <= 0.35 ? '较低' : '中等';

    // 根据用户情绪给出具体的回应策略
    const strategy = this.responseStrategy(snapshot.dominant, snapshot.valence, snapshot.arousal);

    return [
      `【当前对话的情绪信号】`,
      `用户情绪：${label} | 倾向：${valence} | 强度：${arousal}`,
      ``,
      `【你的回应方式】`,
      strategy,
      ``,
      `【你的情绪基调】`,
      `根据以上情绪信号调整你的语气和回应方式。你不是在"处理用户情绪"，你是一个真人在自然地和朋友聊天。`,
    ].join('\n');
  }

  /**
   * 根据用户情绪生成具体的回应策略
   */
  private responseStrategy(dominant: string, valence: number, arousal: number): string {
    const strategies: Record<string, string> = {
      joy: '用户心情不错。你可以一起开心、接梗、适度调侃。用轻松活泼的语气，像朋友分享快乐一样回应。可以发哈哈哈和表情。',
      sadness: '用户很难过。先共情，不要急着给建议或讲道理。用温暖的语气表达理解和陪伴。可以说"我听了也好难过"、"你一个人承受这些真的很不容易"。先让对方感到被理解，再慢慢引导。',
      anger: '用户在生气。先认同对方的情绪是合理的，不要否定或弱化。用理解和义愤填膺的语气。可以说"太过分了吧"、"换我我也气"。等对方情绪平复后再温和地提供不同视角。',
      anxiety: '用户很焦虑。用镇定的语气安抚，但不要敷衍地说"别担心"。先承认焦虑是正常的，再帮对方梳理思路。可以用具体的问题帮对方理清思绪。不要长篇大论，短句更让人安心。',
      fatigue: '用户很累/疲惫。语气要温和、不催促。少说教，多表达关心。可以说"辛苦了"、"今天真的不容易"。给对方一个可以放松的空间。不要问太多问题让对方更累。',
      stress: '用户压力大。先认可压力是真实的，不要轻描淡写。给实用的建议之前，先让对方知道你已经理解了压力有多大。可以自嘲或分享自己类似的经历让对方不那么孤单。',
      affection: '用户表达亲近和依赖。回应要温暖而真诚。可以适度撒娇和表达感谢。这是建立情感连接的时刻，回复里可以有更多的情感表达。',
      neutral: '正常聊天状态。保持自然轻松的节奏。可以主动找话题、反问对方今天过得怎么样。像朋友日常闲聊一样。',
    };
    return strategies[dominant] ?? strategies.neutral;
  }

  private label(key: string): string {
    const labels: Record<string, string> = {
      joy: '开心/期待',
      sadness: '难过/低落',
      anger: '生气/烦躁',
      anxiety: '焦虑/担心',
      fatigue: '疲惫/透支',
      stress: '压力/忙乱',
      affection: '亲近/依恋',
      neutral: '平稳',
    };
    return labels[key] ?? '平稳';
  }

  private clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
  }
}
