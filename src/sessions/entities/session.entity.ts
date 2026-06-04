import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id: string; // UUID 自动生成

  @Column({ name: 'character_id' })
  characterId: string; // 关联的角色 ID

  @Column({ nullable: true })
  title: string; // 会话标题

  @Column({ type: 'text', nullable: true })
  summary: string; // 滚动摘要

  @Column({ name: 'message_count', default: 0 })
  messageCount: number; // 消息计数（用于判断是否触发摘要）

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
