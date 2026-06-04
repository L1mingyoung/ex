/**
 * AI Companion API 调用层
 *
 * ⚠️ 纯 TypeScript 模块，不依赖 DOM / React / 任何框架。
 * 可直接复制到微信小程序、React Native、Telegram Bot 等任何 JS 环境中复用。
 *
 * 使用方式：
 *   import { createCharacter, sendMessageStream, ... } from './api/index.js';
 *
 *   微信小程序适配：
 *   - 把 fetch() 替换为 wx.request()
 *   - SSE 流式替换为 wx.request({ enableChunked: true })
 */

import type {
  CharacterData,
  CreateCharacterPayload,
  UpdateCharacterPayload,
  SessionData,
  CreateSessionPayload,
  MessageData,
  SendMessagePayload,
  SendMessageResponse,
  SSECallbacks,
  ApiError,
  ImportChatRecordsPayload,
  ImportChatRecordsResult,
} from '@shared/types';

// Vite dev proxy 转发 /api 到 NestJS，生产模式同源，所以 BASE_URL 为空
const BASE_URL = '';

// ═══════════════════════════════════════
//  通用 HTTP 请求
// ═══════════════════════════════════════

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) options.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${path}`, options);
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.message || `HTTP ${res.status}`) as ApiError;
    err.name = 'ApiError';
    throw err;
  }
  return data as T;
}

// ═══════════════════════════════════════
//  角色 API
// ═══════════════════════════════════════

export function createCharacter(payload: CreateCharacterPayload): Promise<CharacterData> {
  return request<CharacterData>('POST', '/api/characters', payload);
}

export function getCharacters(): Promise<CharacterData[]> {
  return request<CharacterData[]>('GET', '/api/characters');
}

export function getCharacter(id: string): Promise<CharacterData> {
  return request<CharacterData>('GET', `/api/characters/${id}`);
}

export function updateCharacter(id: string, data: UpdateCharacterPayload): Promise<CharacterData> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: Record<string, unknown> = {};
  if (data.name !== undefined) body.name = data.name;
  if (data.base_prompt !== undefined) body.base_prompt = data.base_prompt;
  if (data.model !== undefined) body.model = data.model;
  return request<CharacterData>('PUT', `/api/characters/${id}`, body);
}

export function deleteCharacter(id: string): Promise<void> {
  return request<void>('DELETE', `/api/characters/${id}`);
}

// ═══════════════════════════════════════
//  会话 API
// ═══════════════════════════════════════

export function createSession(payload: CreateSessionPayload): Promise<SessionData> {
  return request<SessionData>('POST', '/api/sessions', payload);
}

export function getSessions(): Promise<SessionData[]> {
  return request<SessionData[]>('GET', '/api/sessions');
}

export function getSession(id: string): Promise<SessionData> {
  return request<SessionData>('GET', `/api/sessions/${id}`);
}

export function deleteSession(id: string): Promise<void> {
  return request<void>('DELETE', `/api/sessions/${id}`);
}

// ═══════════════════════════════════════
//  消息 API
// ═══════════════════════════════════════

export function getMessages(
  sessionId: string,
  limit = 50,
): Promise<MessageData[]> {
  return request<MessageData[]>('GET', `/api/messages?sessionId=${encodeURIComponent(sessionId)}&limit=${limit}`);
}

// ═══════════════════════════════════════
//  聊天 API（同步）
// ═══════════════════════════════════════

export function sendMessage(
  sessionId: string,
  payload: SendMessagePayload,
): Promise<SendMessageResponse> {
  return request<SendMessageResponse>('POST', `/api/chat/${sessionId}`, payload);
}

// ═══════════════════════════════════════
//  聊天 API（SSE 流式）
// ═══════════════════════════════════════

/**
 * 流式发送消息，每收到一个文本片段就调用 onChunk
 *
 * @param sessionId - 会话 ID
 * @param payload - 消息内容
 * @param callbacks - SSE 回调 { onChunk, onDone, onError }
 * @returns AbortController 可用于取消请求
 */
export function sendMessageStream(
  sessionId: string,
  payload: SendMessagePayload,
  callbacks: SSECallbacks,
): AbortController {
  const controller = new AbortController();
  const { onChunk, onDone, onError } = callbacks;

  fetch(`${BASE_URL}/api/chat/${sessionId}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
        throw new Error(err.message || `HTTP ${res.status}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullReply = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 解析 SSE 格式: data: "..."\n\n
        const parts = buffer.split('\n\n');
        buffer = parts.pop()!; // 最后一个可能不完整

        for (const part of parts) {
          const lines = part.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                onDone?.(fullReply);
                return;
              }
              try {
                const chunk: string = JSON.parse(data);
                fullReply += chunk;
                onChunk?.(chunk);
              } catch {
                // 非 JSON 数据忽略
              }
            }
          }
        }
      }
      onDone?.(fullReply);
    })
    .catch((err: Error) => {
      if (err.name !== 'AbortError') {
        onError?.(err);
      }
    });

  return controller;
}

// ═══════════════════════════════════════
//  聊天记录导入 API
// ═══════════════════════════════════════

export function importChatRecords(
  payload: ImportChatRecordsPayload,
): Promise<ImportChatRecordsResult> {
  return request<ImportChatRecordsResult>('POST', '/api/import/chat-records', payload);
}
