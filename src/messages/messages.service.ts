import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message, MessageRole } from './entities/message.entity';

export interface CreateMessageInput {
  sessionId: string;
  role: MessageRole;
  content: string;
  emotionSnapshot?: Record<string, number | string> | null;
}

/**
 * 消息服务 —— 纯数据读写，不涉及业务逻辑
 *
 * 职责：
 *  - 保存用户消息和 AI 回复（create）
 *  - 批量导入历史消息（createMany）
 *  - 读取最近 N 条消息，用于拼接到 LLM 上下文中（findRecent）
 *  - 统计消息数，用于判断是否触发滚动摘要（countBySession）
 */
@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
  ) {}

  /**
   * 保存一条消息
   * @param sessionId - 所属会话 UUID
   * @param role - 'user' | 'assistant'
   * @param content - 消息正文
   * @param emotionSnapshot - jiwen 情绪快照
   */
  create(
    sessionId: string,
    role: MessageRole,
    content: string,
    emotionSnapshot?: Record<string, number | string> | null,
  ) {
    const message = this.messageRepo.create({
      sessionId,
      role,
      content,
      emotionSnapshot: emotionSnapshot ?? null,
    });
    return this.messageRepo.save(message);
  }

  createMany(messages: CreateMessageInput[]) {
    const entities = this.messageRepo.create(
      messages.map((message) => ({
        sessionId: message.sessionId,
        role: message.role,
        content: message.content,
        emotionSnapshot: message.emotionSnapshot ?? null,
      })),
    );
    return this.messageRepo.save(entities);
  }

  /**
   * 获取某会话最近 N 条消息，按时间正序（旧→新）
   * 用途：拼接到 LLM 请求的 messages 数组中，提供即时对话上下文
   */
  async findRecent(sessionId: string, limit = 10): Promise<Message[]> {
    const messages = await this.messageRepo.find({
      where: { sessionId },
      order: { createdAt: 'DESC' }, // 先按时间倒序查出最新的
      take: limit,
    });
    return messages.reverse(); // 反转成正序，符合 LLM API 要求的 user/assistant 交替顺序
  }

  /**
   * 统计某会话的总消息数
   * 用于判断是否触发滚动摘要（>= 50 条且距上次摘要 >= 1 小时）
   */
  async countBySession(sessionId: string): Promise<number> {
    return this.messageRepo.count({ where: { sessionId } });
  }

  /** 按角色取消息（用于分析说话风格） */
  async findByRole(sessionId: string, role: MessageRole, limit = 200): Promise<Message[]> {
    return this.messageRepo.find({
      where: { sessionId, role },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
