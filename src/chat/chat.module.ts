import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Character } from '../characters/entities/character.entity';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { SessionsModule } from '../sessions/sessions.module';
import { MessagesModule } from '../messages/messages.module';
import { LlmModule } from '../llm/llm.module';
import { MemoriesModule } from '../memories/memories.module';

/**
 * 聊天模块 —— 系统的核心，编排一次完整的对话流程
 *
 * 依赖链：
 *   CharactersModule  ─→ 读取角色配置（base_prompt）
 *   SessionsModule    ─→ 读取/更新会话（summary、message_count）
 *   MessagesModule    ─→ 读写消息（全量留存）
 *   LlmModule         ─→ 调用 DeepSeek API
 *   MemoriesModule    ─→ 向量检索历史记忆 + 写入新记忆
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Character]),
    SessionsModule,
    MessagesModule,
    LlmModule,
    MemoriesModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
