import { Controller, Get, Query } from '@nestjs/common';
import { MessagesService } from './messages.service';

/**
 * 消息控制器
 *
 * 端点：
 *  - GET /api/messages?sessionId=<uuid>&limit=50    获取会话历史消息
 */
@Controller('api/messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  /** 获取某会话的历史消息（按时间正序） */
  @Get()
  async findBySession(
    @Query('sessionId') sessionId: string,
    @Query('limit') limit?: string,
  ) {
    if (!sessionId) {
      return [];
    }
    const take = limit ? Math.min(Number.parseInt(limit, 10) || 50, 200) : 50;
    return this.messagesService.findRecent(sessionId, take);
  }
}
