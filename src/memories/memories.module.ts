import { Module } from '@nestjs/common';
import { MemoriesService } from './memories.service';
import { EmbeddingModule } from '../embedding/embedding.module';

/**
 * 记忆模块
 *
 * 注意：不注册 TypeOrmModule.forFeature([MemoryChunk])！
 * 因为 memory_chunks 表有 VECTOR(768) 列，TypeORM 的 synchronize 会删除它。
 * MemoriesService 直接注入 DataSource 进行原生 SQL 操作。
 */
@Module({
  imports: [EmbeddingModule],
  providers: [MemoriesService],
  exports: [MemoriesService],
})
export class MemoriesModule {}
