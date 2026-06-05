import { Injectable } from '@nestjs/common';
import { EmotionSnapshot } from './jiwen-emotion.service';

export interface MoodState {
  valence: number;
  arousal: number;
  label: string;
  recent: string[];
}

interface ToneInfo {
  tone: string;
  emoji: string;
  kaomoji: string;
}

@Injectable()
export class MoodService {
  private readonly moods = new Map<string, MoodState>();

  getOrCreate(sessionId: string): MoodState {
    if (!this.moods.has(sessionId)) {
      this.moods.set(sessionId, {
        valence: 0.55 + Math.random() * 0.1,
        arousal: 0.45 + Math.random() * 0.1,
        label: '平静',
        recent: ['平静'],
      });
    }
    return this.moods.get(sessionId)!;
  }

  update(sessionId: string, userEmotion: EmotionSnapshot | null): MoodState {
    const mood = this.getOrCreate(sessionId);

    if (userEmotion) {
      const userValence = userEmotion.valence ?? 0.5;
      const userArousal = userEmotion.arousal ?? 0.5;
      const intensity = Math.abs(userValence - 0.5) * 2;
      const empathy = 0.15 + intensity * 0.2;
      mood.valence = this.lerp(mood.valence, userValence, empathy);
      mood.arousal = this.lerp(mood.arousal, userArousal, empathy);
    }

    mood.valence = this.lerp(mood.valence, 0.5, 0.05);
    mood.arousal = this.lerp(mood.arousal, 0.5, 0.03);
    mood.valence += (Math.random() - 0.5) * 0.06;
    mood.arousal += (Math.random() - 0.5) * 0.06;
    mood.valence = Math.max(0.05, Math.min(0.95, mood.valence));
    mood.arousal = Math.max(0.05, Math.min(0.95, mood.arousal));

    mood.label = this.toLabel(mood.valence, mood.arousal);
    mood.recent.push(mood.label);
    if (mood.recent.length > 5) mood.recent.shift();

    return mood;
  }

  summarize(mood: MoodState): string | null {
    const { label, valence, arousal } = mood;

    const toneMap: Record<string, ToneInfo> = {
      '开心': { tone: '用轻松活泼的语气回应', emoji: '😊 😆 🎉 💕 ✨', kaomoji: '(๑>ᴗ<๑) (◕‿◕)' },
      '温暖': { tone: '语气温柔关切', emoji: '🥰 💛 🤗 🌸', kaomoji: '(｡･ω･｡)ﾉ♡' },
      '平静': { tone: '自然平和的语气，像日常闲聊', emoji: '😌 💭 ☕', kaomoji: '(￣▽￣)' },
      '疲惫': { tone: '语气稍缓，像累了但还在陪你', emoji: '😮‍💨 🥱 💤', kaomoji: '(￣ω￣;)' },
      '低落': { tone: '语气温柔真诚地表达关心', emoji: '🥺 💧 😢', kaomoji: '(╥﹏╥) (´；ω；`)' },
      '兴奋': { tone: '话多一点，用感叹号表达兴奋', emoji: '🤩 🔥 🎉 💥', kaomoji: 'ヽ(≧∀≦)ﾉ (ﾉ◕ヮ◕)ﾉ' },
      '烦躁': { tone: '语气稍显不耐，像朋友吐槽', emoji: '😤 🙄 😑 💢', kaomoji: '(╬ Ò﹏Ó) (¬_¬)' },
      '困倦': { tone: '语气慵懒，话少一点', emoji: '😴 🥱 💤', kaomoji: '(￣ρ￣)..zzZ' },
    };

    const info: ToneInfo = toneMap[label] ?? { tone: '自然随意的语气', emoji: '', kaomoji: '' };

    const lines = [
      '【你当前的情绪状态】',
      '你现在的感受：' + label + '（愉悦度 ' + (valence * 100).toFixed(0) + '%，活跃度 ' + (arousal * 100).toFixed(0) + '%）',
      '说话语气：' + info.tone,
      '适合用的表情：' + info.emoji,
      '适合用的颜文字：' + info.kaomoji,
      '',
      '【重要：关于表情使用】',
      '- 你可以在回复中自然地使用 emoji 和颜文字，像真人聊天一样',
      '- 不要用文字描述动作，用表情代替。比如不要说（开心地拍手），而是发 🎉 或 ヽ(≧∀≦)ﾉ',
      '- 不要说（心疼地皱眉），而是发 🥺 或 (´；ω；`)',
      '- 表情要自然融入句子中，每句话最多 1-2 个，不要刷屏',
      '- 你是真人，不需要用括号描述自己的动作，用表情符号就能传达情绪',
    ];

    return lines.join('\n');
  }

  clear(sessionId: string) {
    this.moods.delete(sessionId);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  private toLabel(valence: number, arousal: number): string {
    if (valence > 0.62 && arousal > 0.55) return '开心';
    if (valence > 0.62 && arousal <= 0.55) return '温暖';
    if (valence < 0.38 && arousal > 0.55) return '烦躁';
    if (valence < 0.38 && arousal <= 0.55) return '低落';
    if (arousal > 0.62) return '兴奋';
    if (arousal < 0.33) return '困倦';
    return '平静';
  }
}
