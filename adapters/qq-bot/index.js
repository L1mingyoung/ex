/**
 * QQ Bot 适配器 — 连接 QQ 到 AI Companion
 *
 * 架构：
 *   QQ 用户消息 → WebSocket → 本适配器 → NestJS API → DeepSeek → 回复到 QQ
 *
 * 使用：
 *   1. 在 https://q.qq.com 注册 Bot，获取 appId + token
 *   2. 填到下方 CONFIG 或 .env
 *   3. node adapters/qq-bot/index.js
 *
 * 前置条件：
 *   - NestJS 运行在 localhost:3000
 *   - Python Embedding 运行在 localhost:8000
 *   - 已在 NestJS 中创建角色和会话
 */

const WebSocket = require('ws');

// ═══════════════════════════════════════
//  配置（从环境变量读取，或直接填）
// ═══════════════════════════════════════

const CONFIG = {
  appId: process.env.QQ_BOT_APP_ID || '',
  appSecret: process.env.QQ_BOT_APP_SECRET || '',
  token: process.env.QQ_BOT_TOKEN || '', // 手动填 token 可跳过自动获取
  // QQ Bot 的 WebSocket 网关
  gateway: 'wss://api.sgroup.qq.com/websocket',
  // 我们的 NestJS API
  apiBase: process.env.API_BASE || 'http://localhost:3000',
  // AI 角色 ID
  characterId: process.env.QQ_CHARACTER_ID || 'xiaoya',
};

/** 用 appSecret 自动获取 access_token */
async function fetchToken(appId, appSecret) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const data = JSON.stringify({ appId, clientSecret: appSecret });
    const req = https.request(
      {
        hostname: 'bots.qq.com',
        path: '/app/getAppAccessToken',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          const result = JSON.parse(b);
          if (result.access_token) {
            resolve(result.access_token);
          } else {
            reject(new Error('获取 token 失败: ' + JSON.stringify(result)));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ═══════════════════════════════════════
//  会话映射：QQ 用户 → sessionId
// ═══════════════════════════════════════

const sessionMap = new Map(); // qqUserId → sessionId

// ═══════════════════════════════════════
//  HTTP 请求（调 NestJS API）
// ═══════════════════════════════════════

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(CONFIG.apiBase + path);
    const mod = url.protocol === 'https:' ? require('https') : require('http');
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = mod.request(options, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve(JSON.parse(b)));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/** 获取或创建 QQ 用户对应的会话 */
async function getOrCreateSession(qqUserId) {
  if (sessionMap.has(qqUserId)) return sessionMap.get(qqUserId);

  // 创建新会话
  const session = await request('POST', '/api/sessions', {
    characterId: CONFIG.characterId,
    title: `QQ-${qqUserId}`,
  });
  sessionMap.set(qqUserId, session.id);
  console.log(`[Session] QQ用户 ${qqUserId} → session ${session.id}`);
  return session.id;
}

/** 发消息给 AI 并获取回复 */
async function chat(sessionId, content) {
  const result = await request('POST', `/api/chat/${sessionId}`, { content });
  return result.reply;
}

// ═══════════════════════════════════════
//  WebSocket 客户端（QQ Bot 协议）
// ═══════════════════════════════════════

let seq = 0;
let heartbeatInterval = null;

function connect() {
  console.log('[QQ Bot] 连接网关...');
  const ws = new WebSocket(CONFIG.gateway);

  ws.on('open', () => {
    console.log('[QQ Bot] 已连接，正在鉴权...');
  });

  ws.on('message', async (raw) => {
    try {
      const payload = JSON.parse(raw.toString());
      const { op, d, s, t } = payload;
      if (s) seq = s;

      switch (op) {
        case 10: {
          // Hello: 收到心跳间隔，开始鉴权
          const interval = d.heartbeat_interval;
          startHeartbeat(ws, interval);

          // 发送 Identify
          ws.send(
            JSON.stringify({
              op: 2,
              d: {
                token: `QQBot ${CONFIG.appId}.${CONFIG.token}`,
                intents: 1 << 25, // C2C_MESSAGE_CREATE
                shard: [0, 1],
              },
            }),
          );
          console.log('[QQ Bot] 已发送鉴权请求');
          break;
        }

        case 0: {
          // Dispatch: 收到事件
          if (t === 'C2C_MESSAGE_CREATE' || t === 'GROUP_AT_MESSAGE_CREATE') {
            handleMessage(d).catch((err) =>
              console.error('[QQ Bot] 处理消息失败:', err.message),
            );
          }
          break;
        }

        case 11: {
          // Heartbeat ACK
          break;
        }
      }
    } catch (err) {
      console.error('[QQ Bot] 解析消息失败:', err.message);
    }
  });

  ws.on('close', (code) => {
    console.log(`[QQ Bot] 连接断开 (code: ${code})，5 秒后重连...`);
    clearInterval(heartbeatInterval);
    setTimeout(connect, 5000);
  });

  ws.on('error', (err) => {
    console.error('[QQ Bot] 连接错误:', err.message);
  });
}

function startHeartbeat(ws, interval) {
  clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    ws.send(JSON.stringify({ op: 1, d: seq }));
  }, interval);
}

/** 处理 QQ 消息 */
async function handleMessage(d) {
  const content = d.content?.trim();
  const qqUserId = d.author?.id;

  if (!content || !qqUserId) return;
  if (qqUserId === d.author?.bot_id) return; // 不回复自己的消息

  console.log(`[Message] ${d.author?.username || qqUserId}: ${content}`);

  try {
    const sessionId = await getOrCreateSession(qqUserId);
    const reply = await chat(sessionId, content);

    // 通过 HTTP API 回复
    await sendReply(d, reply);
    console.log(`[Reply] → ${reply.substring(0, 50)}`);
  } catch (err) {
    console.error('[QQ Bot] 回复失败:', err.message);
  }
}

/** 发送回复到 QQ */
async function sendReply(originalMsg, content) {
  const url = `https://api.sgroup.qq.com/v2/users/${originalMsg.author.id}/messages`;

  const mod = require('https');
  const data = JSON.stringify({
    content: content,
    msg_id: originalMsg.id,
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.sgroup.qq.com',
      path: `/v2/users/${originalMsg.author.id}/messages`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `QQBot ${CONFIG.appId}.${CONFIG.token}`,
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = mod.request(options, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve(JSON.parse(b)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ═══════════════════════════════════════
//  启动
// ═══════════════════════════════════════

// ═══════════════════════════════════════
//  启动
// ═══════════════════════════════════════

async function start() {
  if (!CONFIG.appId) {
    console.error('请在 .env 中设置 QQ_BOT_APP_ID');
    process.exit(1);
  }

  // 没有手动填 token，用 appSecret 自动获取
  if (!CONFIG.token && CONFIG.appSecret) {
    console.log('[QQ Bot] 正在用 appSecret 获取 token...');
    try {
      CONFIG.token = await fetchToken(CONFIG.appId, CONFIG.appSecret);
      console.log('[QQ Bot] token 获取成功');
    } catch (err) {
      console.error('[QQ Bot] token 获取失败:', err.message);
      console.error('也可以手动填 QQ_BOT_TOKEN 跳过自动获取');
      process.exit(1);
    }
  }

  if (!CONFIG.token) {
    console.error('请设置 QQ_BOT_TOKEN 或 QQ_BOT_APP_SECRET');
    process.exit(1);
  }

  console.log('╔══════════════════════════════════╗');
  console.log('║   AI Companion QQ Bot 适配器    ║');
  console.log('╚══════════════════════════════════╝');
  console.log('API:', CONFIG.apiBase);
  console.log('角色:', CONFIG.characterId);
  console.log('');

  connect();
}

start();
