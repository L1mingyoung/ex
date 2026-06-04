import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EmbeddingService } from '../embedding/embedding.service';

export type MemoryType = 'fact' | 'preference' | 'emotion';

/**
 * 记忆服务 —— 向量检索 + 写入 + 查重
 *
 * 重要：此表不通过 TypeORM Entity 管理！
 * 因为 memory_chunks 有 VECTOR(768) 列，TypeORM 的 synchronize 会删除它。
 * 全部操作走 this.db.query() 原生 SQL。
 *
 * 表结构（手动创建）：
 *   id BIGSERIAL PRIMARY KEY
 *   session_id UUID → sessions(id)
 *   source_msg_id BIGINT → messages(id)
 *   content TEXT
 *   embedding VECTOR(768)       ← TypeORM 不支持！
 *   memory_type TEXT CHECK(...)
 *   importance_score FLOAT
 *   created_at TIMESTAMPTZ
 *   last_accessed TIMESTAMPTZ
 *
 * 索引：
 *   idx_memory_embedding (hnsw, cosine)
 *   idx_memory_session (session_id, created_at)
 */
@Injectable()
export class MemoriesService {
  constructor(
    private readonly db: DataSource, // 直接用 DataSource，不依赖 Entity Repository
    private readonly embeddingService: EmbeddingService,
  ) {}

  /**
   * 向量相似度检索
   *
   * `<=>` 是 pgvector 的 cosine distance 运算符
   * `1 - (embedding <=> query)` = cosine similarity（0~1，越大越相似）
   */
  async search(
    sessionId: string,
    queryEmbedding: number[],
    limit = 5,
  ): Promise<{ id: number; content: string; memory_type: string; similarity: number }[]> {
    const vectorStr = `[${queryEmbedding.join(',')}]`;

    const sql = `
      SELECT id, content, memory_type,
             1 - (embedding <=> $1::vector) AS similarity
      FROM memory_chunks
      WHERE session_id = $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3
    `;

    return this.db.query(sql, [vectorStr, sessionId, limit]);
  }

  /**
   * 写入记忆（含 VECTOR 列）
   */
  async addMemory(
    sessionId: string,
    content: string,
    embedding: number[],
    sourceMsgId?: number,
    memoryType: MemoryType = 'fact',
  ) {
    const vectorStr = `[${embedding.join(',')}]`;

    const sql = `
      INSERT INTO memory_chunks
        (session_id, source_msg_id, content, embedding, memory_type)
      VALUES ($1, $2, $3, $4::vector, $5)
      RETURNING id, content, memory_type, created_at
    `;

    const result = await this.db.query(sql, [
      sessionId,
      sourceMsgId ?? null,
      content,
      vectorStr,
      memoryType,
    ]);
    return result[0];
  }

  /**
   * 查重：cosine similarity > threshold → 重复
   */
  async checkDuplicate(
    sessionId: string,
    embedding: number[],
    threshold = 0.95,
  ): Promise<boolean> {
    const vectorStr = `[${embedding.join(',')}]`;

    const sql = `
      SELECT 1
      FROM memory_chunks
      WHERE session_id = $1
        AND 1 - (embedding <=> $2::vector) > $3
      LIMIT 1
    `;

    const result = await this.db.query(sql, [sessionId, vectorStr, threshold]);
    return result.length > 0;
  }

  /**
   * 便捷方法：文本 → 向量化 → 检索
   */
  async searchByText(sessionId: string, text: string, limit = 5) {
    const embedding = await this.embeddingService.embed(text);
    return this.search(sessionId, embedding, limit);
  }

  /**
   * 便捷方法：文本 → 向量化 → 查重 → 写入
   * 返回 null 表示重复跳过
   */
  async addMemoryByText(
    sessionId: string,
    content: string,
    memoryType: MemoryType = 'fact',
    sourceMsgId?: number,
  ) {
    const embedding = await this.embeddingService.embed(content);

    const isDup = await this.checkDuplicate(sessionId, embedding);
    if (isDup) return null;

    return this.addMemory(sessionId, content, embedding, sourceMsgId, memoryType);
  }
}
