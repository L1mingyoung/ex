import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('characters')
export class Character {
  @PrimaryColumn({ type: 'text' })
  id: string; // 如 "xiaoya"，手动指定的短标识

  @Column()
  name: string; // 显示名称，如 "小雅"

  @Column({ type: 'text', name: 'base_prompt' })
  basePrompt: string; // 固定人格 prompt

  @Column({ default: 'deepseek-chat' })
  model: string; // 使用哪个 LLM 模型

  @Column({ type: 'jsonb', default: {}, name: 'speech_patterns' })
  speechPatterns: Record<string, any>; // 说话模式 JSON

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
