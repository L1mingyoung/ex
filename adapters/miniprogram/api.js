/**
 * 微信小程序适配器
 *
 * 把 client/js/api.js 的 fetch() 替换为 wx.request()。
 * 函数签名完全一致，切换平台只需改 import。
 *
 * 注意：
 *   - 微信小程序不支持 SSE 流式（sendMessageStream 使用同步版本替代）
 *   - 需要在小程序后台配置服务器域名白名单
 */

const BASE_URL = 'https://your-server.com'; // 生产环境域名

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}${path}`,
      method,
      header: { 'Content-Type': 'application/json' },
      data: body,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(new Error(res.data.message || `HTTP ${res.statusCode}`));
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

/**
 * 小程序暂不支持 SSE 流式，降级为同步请求
 * 返回完整回复文本
 */
export function sendMessageStream(sessionId, content, { onChunk, onDone, onError }) {
  sendMessage(sessionId, content)
    .then((data) => {
      onChunk?.(data.reply);    // 整段作为"一个 chunk"
      onDone?.(data.reply);
    })
    .catch(onError);
}
