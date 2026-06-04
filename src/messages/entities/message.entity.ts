import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export type MessageRole = 'user' | 'assistant';

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn()
  id: number; // BIGSERIAL 自增主键

  @Column({ name: 'session_id' })
  sessionId: string; // 所属会话 UUID

  @Column({ type: 'enum', enum: ['user', 'assistant'] })
  role: MessageRole;

  @Column({ type: 'text' })
  content: string; // 消息正文

  @Column({ type: 'jsonb', nullable: true, name: 'emotion_snapshot' })
  emotionSnapshot: Record<string, number | string> | null; // 情绪快照（后期接 jiwen 引擎）

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
