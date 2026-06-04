import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { LlmService } from './llm.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 60000,
      maxRedirects: 5,
    }),
  ],
  providers: [LlmService],
  exports: [LlmService], // 导出给 ChatModule 使用
})
export class LlmModule {}
