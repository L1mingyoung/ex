import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

/**
 * Embedding 服务 —— 通过 HTTP 调用 Python FastAPI 向量化服务
 *
 * 职责单一：把文本发给 Python 服务，拿回 768 维向量。
 * 不负责检索（检索在 MemoriesService 里用 PostgreSQL 做）。
 *
 * Python 服务地址在 .env 的 PYTHON_EMBED_URL 配置。
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly pythonUrl: string;

  constructor(private readonly httpService: HttpService) {
    this.pythonUrl = process.env.PYTHON_EMBED_URL ?? 'http://localhost:8000';
    this.logger.log(`Python Embedding 服务地址: ${this.pythonUrl}`);
  }

  /**
   * 单条文本 → 768 维向量
   *
   * HTTP 请求：
   *   POST {pythonUrl}/embed
   *   Body: { "text": "你好世界" }
   *
   * 返回：
   *   [0.123, -0.456, ...]  共 768 个浮点数
   */
  async embed(text: string): Promise<number[]> {
    const { data } = await firstValueFrom(
      this.httpService.post<{ embedding: number[] }>(
        `${this.pythonUrl}/embed`,
        { text },
        { timeout: 10000 }, // 单条推理 10 秒超时
      ),
    );
    return data.embedding;
  }

  /**
   * 批量文本 → 多个 768 维向量
   *
   * HTTP 请求：
   *   POST {pythonUrl}/batch_embed
   *   Body: ["文本1", "文本2", ...]
   *
   * 返回：
   *   [[0.1, 0.2, ...], [0.3, 0.4, ...], ...]
   *
   * 批量比逐条调用更快（模型推理可以 batch 并行）。
   */
  async batchEmbed(texts: string[]): Promise<number[][]> {
    const { data } = await firstValueFrom(
      this.httpService.post<{ embeddings: number[][] }>(
        `${this.pythonUrl}/batch_embed`,
        texts,
        { timeout: 30000 }, // 批量推理 30 秒超时
      ),
    );
    return data.embeddings;
  }

  /**
   * 检查 Python 服务是否在线
   */
  async healthCheck(): Promise<boolean> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<{ status: string }>(
          `${this.pythonUrl}/health`,
          { timeout: 3000 },
        ),
      );
      return data.status === 'ok';
    } catch {
      return false;
    }
  }
}
