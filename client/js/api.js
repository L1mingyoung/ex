/**
 * AI Companion API 调用层
 *
 * ⚠️ 纯函数，不依赖 DOM/浏览器。
 * 可直接复制到微信小程序、React Native、Telegram Bot 等任何 JS 环境中复用。
 *
 * 使用方式：
 *   import { createCharacter, sendMessageStream, ... } from './api.js';
 *
 *   微信小程序适配：
 *   - 把 fetch() 替换为 wx.request()
 *   - SSE 流式替换为 wx.request({ enableChunked: true })
 */

const BASE_URL = 'http://localhost:3000';

// ═══════════════════════════════════════
//  通用 HTTP 请求
// ═══════════════════════════════════════

async function request(method, path, body) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${path}`, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

// ═══════════════════════════════════════
//  角色 API
// ═══════════════════════════════════════

export function createCharacter(id, name, basePrompt, model = 'deepseek-chat') {
  return request('POST', '/api/characters', { id, name, base_prompt: basePrompt, model });
}

export function getCharacters() {
  return request('GET', '/api/characters');
}

export function getCharacter(id) {
  return request('GET', `/api/characters/${id}`);
}

export function updateCharacter(id, data) {
  return request('PUT', `/api/characters/${id}`, {
    ...(data.name !== undefined && { name: data.name }),
    ...(data.basePrompt !== undefined && { base_prompt: data.basePrompt }),
    ...(data.model !== undefined && { model: data.model }),
  });
}

export function deleteCharacter(id) {
  return request('DELETE', `/api/characters/${id}`);
}

// ═══════════════════════════════════════
//  会话 API
// ═══════════════════════════════════════

export function createSession(characterId, title) {
  return request('POST', '/api/sessions', { characterId, title });
}

export function getSessions() {
  return request('GET', '/api/sessions');
}

export function getSession(id) {
  return request('GET', `/api/sessions/${id}`);
}

export function deleteSession(id) {
  return request('DELETE', `/api/sessions/${id}`);
}

// ═══════════════════════════════════════
//  聊天 API（同步）
// ═══════════════════════════════════════

export function sendMessage(sessionId, content) {
  return request('POST', `/api/chat/${sessionId}`, { content });
}

// ═══════════════════════════════════════
//  聊天 API（SSE 流式）
// ═══════════════════════════════════════

/**
 * 流式发送消息，每收到一个文本片段就调用 onChunk
 *
 * @param {string} sessionId
 * @param {string} content
 * @param {(chunk: string) => void} onChunk  - 每收到一段文本时调用
 * @param {(fullReply: string) => void} onDone - 流结束时调用
 * @param {(err: Error) => void} onError       - 出错时调用
 * @returns {AbortController} 可用于取消请求
 */
export function sendMessageStream(sessionId, content, { onChunk, onDone, onError }) {
  const controller = new AbortController();

  fetch(`${BASE_URL}/api/chat/${sessionId}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
        throw new Error(err.message);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullReply = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 解析 SSE 格式: data: "..."\n\n
        const parts = buffer.split('\n\n');
        buffer = parts.pop(); // 最后一个可能不完整

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
                const chunk = JSON.parse(data);
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
    .catch((err) => {
      if (err.name !== 'AbortError') {
        onError?.(err);
      }
    });

  return controller; // 可用于取消
}
