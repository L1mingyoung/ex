import { Controller, Post, Body, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ChatService } from './chat.service';

interface SendMessageDto {
  content: string;
}

/**
 * 聊天控制器
 *
 * 两个端点：
 *  - POST /api/chat/:sessionId        同步（等完整回复）
 *  - POST /api/chat/:sessionId/stream  SSE 流式（逐字推送）
 */
@Controller('api/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /** 同步模式：等待完整回复 */
  @Post(':sessionId')
  async sendMessage(
    @Param('sessionId') sessionId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.handleMessage(sessionId, dto.content);
  }

  /**
   * SSE 流式模式：逐字推送 AI 回复
   *
   * 前端使用示例：
   *   const response = await fetch('/api/chat/xxx/stream', {
   *     method: 'POST',
   *     headers: { 'Content-Type': 'application/json' },
   *     body: JSON.stringify({ content: '你好' })
   *   });
   *   const reader = response.body.getReader();
   *   const decoder = new TextDecoder();
   *   while (true) {
   *     const { done, value } = await reader.read();
   *     if (done) break;
   *     console.log(decoder.decode(value)); // 逐 chunk 显示
   *   }
   */
  @Post(':sessionId/stream')
  async sendMessageStream(
    @Param('sessionId') sessionId: string,
    @Body() dto: SendMessageDto,
    @Res() res: Response,
  ) {
    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // 禁用 nginx 缓冲
    res.flushHeaders();

    const stream$ = this.chatService.handleMessageStream(sessionId, dto.content);

    stream$.subscribe({
      next: (chunk: string) => {
        // SSE 格式：data: <内容>\n\n
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      },
      error: (err: Error) => {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      },
      complete: () => {
        res.write('data: [DONE]\n\n');
        res.end();
      },
    });
  }
}
