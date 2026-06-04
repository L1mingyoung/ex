import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Observable } from 'rxjs';
import * as http from 'http';
import * as https from 'https';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * LLM 服务 —— DeepSeek API 封装
 *
 * 两种模式：
 *  - chat()：同步，等待完整回复
 *  - chatStream()：流式，返回 Observable<string>，逐 chunk 推送
 */
@Injectable()
export class LlmService {
  private readonly apiKey: string;
  private readonly apiUrl = 'https://api.deepseek.com/chat/completions';

  constructor(private readonly httpService: HttpService) {
    this.apiKey = process.env.DEEPSEEK_API_KEY ?? '';
  }

  /** 同步模式：等待完整回复后返回 */
  async chat(messages: ChatMessage[], options: LlmOptions = {}): Promise<string> {
    const { data } = await firstValueFrom(
      this.httpService.post(
        this.apiUrl,
        {
          model: options.model ?? 'deepseek-chat',
          messages,
          stream: false,
          max_tokens: options.maxTokens ?? 2000,
          temperature: options.temperature ?? 0.8,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        },
      ),
    );
    return data.choices[0].message.content;
  }

  /**
   * 流式模式：返回 Observable，每收到一个文本片段就推送一次
   *
   * 用于 SSE（Server-Sent Events）流式响应。
   * 前端可以逐字/逐句显示 AI 回复，不需要等完整生成。
   *
   * DeepSeek 流式响应格式：
   *   data: {"choices":[{"delta":{"content":"你"}}]}
   *   data: {"choices":[{"delta":{"content":"好"}}]}
   *   data: [DONE]
   */
  chatStream(messages: ChatMessage[], options: LlmOptions = {}): Observable<string> {
    return new Observable<string>((subscriber) => {
      const postData = JSON.stringify({
        model: options.model ?? 'deepseek-chat',
        messages,
        stream: true, // ← 流式模式
        max_tokens: options.maxTokens ?? 2000,
        temperature: options.temperature ?? 0.8,
      });

      const url = new URL(this.apiUrl);
      const reqOptions: https.RequestOptions = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'Accept': 'text/event-stream',
        },
      };

      const req = https.request(reqOptions, (res) => {
        let buffer = '';

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf-8');

          // SSE 格式：每行以 "data: " 开头，以 "\n\n" 结尾
          const lines = buffer.split('\n');
          // 最后一个可能是不完整的行，保留到下次
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;

            const jsonStr = trimmed.slice(6); // 去掉 "data: " 前缀
            if (jsonStr === '[DONE]') {
              subscriber.complete();
              return;
            }

            try {
              const parsed = JSON.parse(jsonStr);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                subscriber.next(content);
              }
            } catch {
              // 解析失败的行忽略
            }
          }

          // 流结束时处理残留 buffer
          res.on('end', () => {
            subscriber.complete();
          });
        });
      });

      req.on('error', (err) => {
        subscriber.error(err);
      });

      req.write(postData);
      req.end();

      // 取消订阅时关闭请求
      return () => {
        req.destroy();
      };
    });
  }
}
