import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export type MemoryType = 'fact' | 'preference' | 'emotion';

/**
 * 记忆碎片 Entity
 *
 * ⚠️ 注意：embedding (VECTOR(768)) 字段不在此映射！
 * TypeORM 原生不支持 pgvector 的 vector 类型。
 * 向量相关的操作（插入、检索、查重）全部走 MemoriesService 里的 Raw SQL。
 *
 * 这就是"最终方案"第五章的设计原则：
 *   - 关系字段 → TypeORM Repository
 *   - 向量字段 → repo.query() 原生 SQL
 */
@Entity('memory_chunks')
export class MemoryChunk {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'session_id' })
  sessionId: string;

  @Column({ name: 'source_msg_id', nullable: true, type: 'bigint' })
  sourceMsgId: number; // 从哪条消息提取的（可为 null）

  @Column({ type: 'text' })
  content: string; // 记忆内容，如 "用户住在北京"

  // embedding VECTOR(768) — 不映射，走 Raw SQL

  @Column({ type: 'enum', enum: ['fact', 'preference', 'emotion'], name: 'memory_type' })
  memoryType: MemoryType;

  @Column({ name: 'importance_score', type: 'float', default: 0.5 })
  importanceScore: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'last_accessed', type: 'timestamptz', default: () => 'NOW()' })
  lastAccessed: Date;
}
