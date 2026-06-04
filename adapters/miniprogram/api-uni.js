/**
 * uni-app 跨端适配器
 *
 * uni-app 的 uni.request() 同时兼容：
 *   - 微信小程序
 *   - 支付宝小程序
 *   - H5 (浏览器)
 *   - App (iOS/Android)
 *
 * H5 环境下 uni.request() 底层就是 fetch()，支持 SSE 流式。
 * 小程序环境下降级为同步请求。
 *
 * 使用：
 *   import * as API from './adapters/miniprogram/api-uni.js';
 */

const BASE_URL = 'https://your-server.com'; // 或 http://localhost:3000 (开发)

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: `${BASE_URL}${path}`,
      method,
      header: { 'Content-Type': 'application/json' },
      data: body,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(new Error(res.data?.message || `HTTP ${res.statusCode}`));
        }
      },
      fail(err) {
        reject(err);
      },
    });
  });
}

export function createCharacter(id, name, basePrompt, model = 'deepseek-chat') {
  return request('POST', '/api/characters', { id, name, base_prompt: basePrompt, model });
}

export function getCharacters() {
  return request('GET', '/api/characters');
}

export function getCharacter(id) {
  return request('GET', `/api/characters/${id}`);
}

export function deleteCharacter(id) {
  return request('DELETE', `/api/characters/${id}`);
}

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

export function sendMessage(sessionId, content) {
  return request('POST', `/api/chat/${sessionId}`, { content });
}

/** 降级为同步请求 */
export function sendMessageStream(sessionId, content, { onChunk, onDone, onError }) {
  sendMessage(sessionId, content)
    .then((data) => {
      onChunk?.(data.reply);
      onDone?.(data.reply);
    })
    .catch(onError);
}
