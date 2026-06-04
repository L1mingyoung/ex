import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { EmbeddingService } from './embedding.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 3,
    }),
  ],
  providers: [EmbeddingService],
  exports: [EmbeddingService], // 导出给 ChatService、MemoriesService 等使用
})
export class EmbeddingModule {}
