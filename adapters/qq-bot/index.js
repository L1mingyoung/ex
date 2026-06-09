// 加载 .env（本地开发用，Docker 中通过环境变量传入，无需 .env 文件）
const dotenvPath = require('path').join(__dirname, '..', '..', '.env');
if (require('fs').existsSync(dotenvPath)) {
    require('dotenv').config({ path: dotenvPath });
}

/**
 * QQ Bot 适配器 v2 — 连接 QQ 到 AI Companion
 *
 * 架构：
 *   QQ 用户消息 → WebSocket → 本适配器 → NestJS API → DeepSeek → 回复到 QQ
 *
 * 使用：
 *   1. 在 https://q.qq.com 注册 Bot，获取 appId + appSecret
 *   2. 填到 .env（QQ_BOT_APP_ID, QQ_BOT_APP_SECRET）
 *   3. npm run qqbot 或 node adapters/qq-bot/index.js
 *
 * 前置条件：
 *   - NestJS 运行在 localhost:3000
 *   - 已在 NestJS 中创建角色和会话
 *
 * v2 改进：
 *   - Access Token 鉴权（旧 Token 方式已废弃）
 *   - Op 6 Resume 断线恢复（不丢消息）
 *   - 群聊消息支持
 *   - 消息去重（幂等处理）
 *   - 频率限制控制
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════
//  配置（从环境变量读取）
// ═══════════════════════════════════════

const CONFIG = {
    appId: process.env.QQ_BOT_APP_ID || '',
    appSecret: process.env.QQ_BOT_APP_SECRET || '',
    apiBase: process.env.API_BASE || 'http://localhost:3000',
    characterId: process.env.QQ_CHARACTER_ID || 'xiaoya',
    // 沙箱模式（true = 沙箱网关，false = 正式网关）
    sandbox: process.env.QQ_BOT_SANDBOX === '1',
};

const GATEWAY = CONFIG.sandbox
    ? 'wss://sandbox.api.sgroup.qq.com/websocket'
    : 'wss://api.sgroup.qq.com/websocket';

const API_HOST = CONFIG.sandbox
    ? 'sandbox.api.sgroup.qq.com'
    : 'api.sgroup.qq.com';

// 状态持久化文件（重启后可 Resume）
const STATE_FILE = path.join(__dirname, '.qq-bot-state.json');

// ═══════════════════════════════════════
//  Access Token 管理
// ═══════════════════════════════════════

let accessToken = '';
let tokenExpireAt = 0;

/** 获取或刷新 Access Token（有效期 72 小时，提前 1 小时刷新） */
async function getAccessToken() {
    if (accessToken && Date.now() < tokenExpireAt) {
        return accessToken;
    }
    console.log('[Auth] 获取 Access Token...');
    const data = JSON.stringify({ appId: CONFIG.appId, clientSecret: CONFIG.appSecret });
    const result = await httpsRequest('POST', 'bots.qq.com', '/app/getAppAccessToken', data);
    if (result.access_token) {
        accessToken = result.access_token;
        // expires_in 单位秒，提前 3600 秒刷新
        const expiresIn = parseInt(result.expires_in || '7200', 10);
        tokenExpireAt = Date.now() + (expiresIn - 3600) * 1000;
        console.log(`[Auth] Token 获取成功，${expiresIn}s 后过期`);
        return accessToken;
    }
    throw new Error('获取 token 失败: ' + JSON.stringify(result));
}

/** 生成鉴权 Header */
function authHeader() {
    return `QQBot ${CONFIG.appId}.${accessToken}`;
}

// ═══════════════════════════════════════
//  会话映射：QQ 用户 → sessionId
// ═══════════════════════════════════════

const sessionMap = new Map(); // qqUserId → sessionId

// ═══════════════════════════════════════
//  消息去重
// ═══════════════════════════════════════

const processedMsgs = new Set(); // 已处理的消息 ID
const MAX_DEDUP_SIZE = 1000;

function isDuplicate(msgId) {
    if (!msgId) return false;
    if (processedMsgs.has(msgId)) return true;
    processedMsgs.add(msgId);
    // 超出上限时清理旧记录
    if (processedMsgs.size > MAX_DEDUP_SIZE) {
        const first = processedMsgs.values().next().value;
        processedMsgs.delete(first);
    }
    return false;
}

// ═══════════════════════════════════════
//  频率限制（QQ 被动回复：5分钟内最多2条）
// ═══════════════════════════════════════

const replyCount = new Map(); // msgId → 已回复次数

function canReply(msgId) {
    const count = replyCount.get(msgId) || 0;
    return count < 2; // 最多 2 条被动回复
}

function recordReply(msgId) {
    replyCount.set(msgId, (replyCount.get(msgId) || 0) + 1);
    // 5 分钟后自动清理
    setTimeout(() => replyCount.delete(msgId), 5 * 60 * 1000);
}

// ═══════════════════════════════════════
//  HTTP 请求工具
// ═══════════════════════════════════════

function httpsRequest(method, hostname, urlPath, body) {
    return new Promise((resolve, reject) => {
        const https = require('https');
        const data = body || null;
        const options = {
            hostname,
            path: urlPath,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
            },
        };
        const req = https.request(options, (res) => {
            let b = '';
            res.on('data', (c) => (b += c));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(b));
                } catch {
                    resolve({ raw: b });
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('请求超时'));
        });
        if (data) req.write(data);
        req.end();
    });
}

/** 调 NestJS API */
function apiRequest(method, apiPath, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(CONFIG.apiBase + apiPath);
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
            res.on('end', () => {
                try {
                    resolve(JSON.parse(b));
                } catch {
                    resolve({ raw: b });
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('API 请求超时'));
        });
        if (data) req.write(data);
        req.end();
    });
}

// ═══════════════════════════════════════
//  业务逻辑：会话管理 + 聊天
// ═══════════════════════════════════════

/** 获取或创建 QQ 用户对应的会话 */
async function getOrCreateSession(qqUserId) {
    if (sessionMap.has(qqUserId)) return sessionMap.get(qqUserId);

    const session = await apiRequest('POST', '/api/sessions', {
        characterId: CONFIG.characterId,
        title: `QQ-${qqUserId}`,
    });
    sessionMap.set(qqUserId, session.id);
    console.log(`[Session] QQ用户 ${qqUserId} → session ${session.id}`);
    return session.id;
}

/** 发消息给 AI 并获取回复 */
async function chat(sessionId, content) {
    const result = await apiRequest('POST', `/api/chat/${sessionId}`, { content });
    return result.reply;
}

// ═══════════════════════════════════════
//  QQ API：发送回复
// ═══════════════════════════════════════

/** 发送私聊回复 */
async function sendC2CReply(userId, content, msgId) {
    const data = JSON.stringify({ content, msg_id: msgId });
    return httpsRequest(
        'POST',
        API_HOST,
        `/v2/users/${userId}/messages`,
        data,
    ).then((res) => {
        recordReply(msgId);
        return res;
    });
}

/** 发送群聊回复 */
async function sendGroupReply(groupId, content, msgId) {
    const data = JSON.stringify({ content, msg_id: msgId });
    const token = await getAccessToken();
    return new Promise((resolve, reject) => {
        const https = require('https');
        const options = {
            hostname: API_HOST,
            path: `/v2/groups/${groupId}/messages`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `QQBot ${CONFIG.appId}.${token}`,
                'Content-Length': Buffer.byteLength(data),
            },
        };
        const req = https.request(options, (res) => {
            let b = '';
            res.on('data', (c) => (b += c));
            res.on('end', () => {
                recordReply(msgId);
                try {
                    resolve(JSON.parse(b));
                } catch {
                    resolve({ raw: b });
                }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

// ═══════════════════════════════════════
//  WebSocket 客户端（QQ Bot 协议）
// ═══════════════════════════════════════

let seq = 0;
let sessionId = ''; // QQ 平台的 session_id（非我们的业务 session）
let heartbeatInterval = null;
let isResuming = false;

/** 保存状态（用于 Resume） */
function saveState() {
    try {
        fs.writeFileSync(
            STATE_FILE,
            JSON.stringify({ seq, sessionId, timestamp: Date.now() }),
        );
    } catch (err) {
        // 写入失败不阻塞主流程
    }
}

/** 加载上次状态 */
function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
            // 超过 30 分钟不 Resume（QQ 平台限制）
            if (Date.now() - state.timestamp < 30 * 60 * 1000) {
                return state;
            }
        }
    } catch {
        // 忽略
    }
    return null;
}

function connect() {
    const prevState = loadState();

    if (prevState && prevState.sessionId) {
        isResuming = true;
        seq = prevState.seq;
        sessionId = prevState.sessionId;
        console.log(`[QQ Bot] 尝试 Resume（seq=${seq}）...`);
    } else {
        isResuming = false;
        seq = 0;
    }

    console.log(`[QQ Bot] 连接网关 ${GATEWAY}...`);
    const ws = new WebSocket(GATEWAY);

    ws.on('open', async () => {
        console.log('[QQ Bot] 已连接');
        // 确保有 token
        try {
            await getAccessToken();
        } catch (err) {
            console.error('[QQ Bot] Token 获取失败:', err.message);
            ws.close();
            return;
        }
    });

    ws.on('message', async (raw) => {
        try {
            const payload = JSON.parse(raw.toString());
            const { op, d, s, t } = payload;
            if (s) seq = s;

            switch (op) {
                case 10: {
                    // Hello: 收到心跳间隔
                    const interval = d.heartbeat_interval;
                    startHeartbeat(ws, interval);

                    const token = await getAccessToken();

                    if (isResuming) {
                        // Op 6 Resume
                        ws.send(
                            JSON.stringify({
                                op: 6,
                                d: {
                                    token: authHeader(),
                                    session_id: sessionId,
                                    seq,
                                },
                            }),
                        );
                        console.log('[QQ Bot] 已发送 Resume 请求');
                    } else {
                        // Op 2 Identify
                        ws.send(
                            JSON.stringify({
                                op: 2,
                                d: {
                                    token: authHeader(),
                                    intents: (1 << 25), // C2C_MESSAGE_CREATE + GROUP_AT_MESSAGE_CREATE
                                    shard: [0, 1],
                                },
                            }),
                        );
                        console.log('[QQ Bot] 已发送鉴权请求');
                    }
                    break;
                }

                case 0: {
                    // Dispatch: 收到事件
                    if (t === 'READY') {
                        // 鉴权成功
                        sessionId = d.session_id;
                        console.log(`[QQ Bot] 鉴权成功，Bot: ${d.user?.username}`);
                        saveState();
                    } else if (t === 'RESUMED') {
                        console.log('[QQ Bot] Resume 成功，已补发遗漏事件');
                        isResuming = false;
                        saveState();
                    } else if (t === 'C2C_MESSAGE_CREATE') {
                        handleC2CMessage(d).catch((err) =>
                            console.error('[QQ Bot] 处理私聊消息失败:', err.message),
                        );
                    } else if (t === 'GROUP_AT_MESSAGE_CREATE') {
                        handleGroupMessage(d).catch((err) =>
                            console.error('[QQ Bot] 处理群消息失败:', err.message),
                        );
                    }

                    // 每次收到事件保存状态
                    saveState();
                    break;
                }

                case 7: {
                    // Reconnect: 平台要求重连
                    console.log('[QQ Bot] 平台要求重连，正在重连...');
                    clearInterval(heartbeatInterval);
                    ws.close();
                    break;
                }

                case 9: {
                    // Invalid Session: 鉴权失败
                    console.error('[QQ Bot] 鉴权失败，清除状态后重连');
                    isResuming = false;
                    try {
                        fs.unlinkSync(STATE_FILE);
                    } catch {
                        // ignore
                    }
                    clearInterval(heartbeatInterval);
                    ws.close();
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
        saveState();
        setTimeout(connect, 5000);
    });

    ws.on('error', (err) => {
        console.error('[QQ Bot] 连接错误:', err.message);
    });
}

function startHeartbeat(ws, interval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        ws.send(JSON.stringify({ op: 1, d: seq || null }));
    }, interval);
}

// ═══════════════════════════════════════
//  消息处理
// ═══════════════════════════════════════

/** 处理私聊消息 */
async function handleC2CMessage(d) {
    const content = d.content?.trim();
    const msgId = d.id;
    const qqUserId = d.author?.id;

    if (!content || !qqUserId || !msgId) return;
    if (isDuplicate(msgId)) {
        console.log(`[Dedup] 跳过重复消息: ${msgId}`);
        return;
    }

    console.log(`[C2C] ${d.author?.username || qqUserId}: ${content}`);

    if (!canReply(msgId)) {
        console.log(`[Rate] 已达回复上限，跳过: ${msgId}`);
        return;
    }

    try {
        const sid = await getOrCreateSession(qqUserId);
        const reply = await chat(sid, content);
        if (!reply) return;

        const token = await getAccessToken();
        await sendC2CReplyWithAuth(qqUserId, reply, msgId, token);
        console.log(`[Reply] → ${reply.substring(0, 50)}`);
    } catch (err) {
        console.error('[QQ Bot] 私聊回复失败:', err.message);
    }
}

/** 处理群聊消息 */
async function handleGroupMessage(d) {
    const content = d.content?.trim();
    const msgId = d.id;
    const qqUserId = d.author?.id;
    const groupId = d.group_id;

    if (!content || !qqUserId || !msgId || !groupId) return;
    if (isDuplicate(msgId)) {
        console.log(`[Dedup] 跳过重复消息: ${msgId}`);
        return;
    }

    console.log(`[Group:${groupId}] ${d.author?.username || qqUserId}: ${content}`);

    if (!canReply(msgId)) {
        console.log(`[Rate] 已达回复上限，跳过: ${msgId}`);
        return;
    }

    try {
        // 群聊用 groupId 作为会话标识
        const sessionKey = `group-${groupId}`;
        const sid = await getOrCreateSession(sessionKey);
        const reply = await chat(sid, content);
        if (!reply) return;

        await sendGroupReply(groupId, reply, msgId);
        console.log(`[Reply:Group] → ${reply.substring(0, 50)}`);
    } catch (err) {
        console.error('[QQ Bot] 群聊回复失败:', err.message);
    }
}

/** 发送私聊回复（带 Auth） */
async function sendC2CReplyWithAuth(userId, content, msgId, token) {
    const data = JSON.stringify({ content, msg_id: msgId });
    return new Promise((resolve, reject) => {
        const https = require('https');
        const options = {
            hostname: API_HOST,
            path: `/v2/users/${userId}/messages`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `QQBot ${CONFIG.appId}.${token}`,
                'Content-Length': Buffer.byteLength(data),
            },
        };
        const req = https.request(options, (res) => {
            let b = '';
            res.on('data', (c) => (b += c));
            res.on('end', () => {
                recordReply(msgId);
                try {
                    resolve(JSON.parse(b));
                } catch {
                    resolve({ raw: b });
                }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

// ═══════════════════════════════════════
//  启动
// ═══════════════════════════════════════

async function start() {
    if (!CONFIG.appId) {
        console.error('错误：请在 .env 中设置 QQ_BOT_APP_ID');
        process.exit(1);
    }
    if (!CONFIG.appSecret) {
        console.error('错误：请在 .env 中设置 QQ_BOT_APP_SECRET');
        process.exit(1);
    }

    console.log('╔══════════════════════════════════════════╗');
    console.log('║   AI Companion QQ Bot 适配器 v2          ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log(`API:      ${CONFIG.apiBase}`);
    console.log(`角色:     ${CONFIG.characterId}`);
    console.log(`网关:     ${GATEWAY}`);
    console.log(`模式:     ${CONFIG.sandbox ? '沙箱' : '正式'}`);
    console.log('');

    connect();
}

start();
