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
// 使用独立目录，避免 Docker volume 覆盖代码文件
const STATE_DIR = process.env.QQ_BOT_STATE_DIR || path.join(__dirname);
const STATE_FILE = path.join(STATE_DIR, '.qq-bot-state.json');

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

/** 生成鉴权 Header（Access Token 模式：QQBot TOKEN） */
function authHeader() {
    return `QQBot ${accessToken}`;
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
                if (res.statusCode >= 400) {
                    reject(new Error(`API ${method} ${apiPath} 返回 ${res.statusCode}: ${b}`));
                    return;
                }
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

/** 统一的 QQ API 请求（带鉴权，私聊/群聊通用） */
async function qqApiRequest(method, urlPath, body) {
    const token = await getAccessToken();
    const data = body ? JSON.stringify(body) : null;
    return new Promise((resolve, reject) => {
        const https = require('https');
        const options = {
            hostname: API_HOST,
            path: urlPath,
            method,
            headers: {
                'Content-Type': 'application/json',
                Authorization: authHeader(),
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
            },
        };
        const req = https.request(options, (res) => {
            let b = '';
            res.on('data', (c) => (b += c));
            res.on('end', () => {
                if (res.statusCode >= 400) {
                    console.error(`[QQ API] ${method} ${urlPath} 返回 ${res.statusCode}: ${b}`);
                    reject(new Error(`QQ API ${res.statusCode}: ${b}`));
                    return;
                }
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
            reject(new Error('QQ API 请求超时'));
        });
        if (data) req.write(data);
        req.end();
    });
}

// ═══════════════════════════════════════
//  业务逻辑：会话管理 + 聊天
// ═══════════════════════════════════════

/** 获取或创建会话（优先复用该角色已有会话，实现 QQ/Web 聊天记录同步） */
async function getOrCreateSession(sessionKey, force = false) {
    if (sessionMap.has(sessionKey) && !force) return sessionMap.get(sessionKey);

    // 先查找该角色是否已有会话（Web 端创建的也算）
    try {
        const sessions = await apiRequest('GET', '/api/sessions');
        const existing = sessions.find((s) => s.characterId === CONFIG.characterId);
        if (existing) {
            sessionMap.set(sessionKey, existing.id);
            saveState();
            console.log(`[Session] 复用已有会话 ${existing.id} (${existing.title || '无标题'})`);
            return existing.id;
        }
    } catch (err) {
        console.log(`[Session] 查询已有会话失败: ${err.message}，将创建新会话`);
    }

    const session = await apiRequest('POST', '/api/sessions', {
        characterId: CONFIG.characterId,
        title: `QQ-${sessionKey}`,
    });
    sessionMap.set(sessionKey, session.id);
    saveState(); // 新会话立即持久化
    console.log(`[Session] ${sessionKey} → 新建 session ${session.id}`);
    return session.id;
}

/** 发消息给 AI 并获取回复（404 时自动重建会话） */
async function chat(sessionKey, sessionId, content) {
    try {
        const result = await apiRequest('POST', `/api/chat/${sessionId}`, { content });
        return result.reply;
    } catch (err) {
        // 会话不存在（数据库被重置/迁移），清除缓存并重建
        if (err.message.includes('404')) {
            console.log(`[Session] ${sessionId} 不存在，重新创建...`);
            const newId = await getOrCreateSession(sessionKey, true);
            const result = await apiRequest('POST', `/api/chat/${newId}`, { content });
            return result.reply;
        }
        throw err;
    }
}

// ═══════════════════════════════════════
//  QQ API：发送回复（统一入口 + 长消息分段）
// ═══════════════════════════════════════

const QQ_MSG_MAX_LENGTH = 2000; // QQ 单条消息最大 2000 字符

/** 将长文本拆成多段 */
function splitMessage(text, maxLen = QQ_MSG_MAX_LENGTH) {
    if (text.length <= maxLen) return [text];
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
        if (remaining.length <= maxLen) {
            chunks.push(remaining);
            break;
        }
        // 尝试在换行处断开
        let cutPoint = remaining.lastIndexOf('\n', maxLen);
        if (cutPoint <= 0) cutPoint = maxLen;
        chunks.push(remaining.substring(0, cutPoint));
        remaining = remaining.substring(cutPoint).trimStart();
    }
    return chunks;
}

/** 发送私聊回复（支持长消息自动分段） */
async function sendC2CReply(userId, content, msgId) {
    const chunks = splitMessage(content);
    for (const chunk of chunks) {
        await qqApiRequest('POST', `/v2/users/${userId}/messages`, {
            content: chunk,
            msg_id: msgId,
        });
        recordReply(msgId);
        // 多段之间稍微间隔，避免被限流
        if (chunks.length > 1) await sleep(500);
    }
}

/** 发送群聊回复（支持长消息自动分段） */
async function sendGroupReply(groupId, content, msgId) {
    const chunks = splitMessage(content);
    for (const chunk of chunks) {
        await qqApiRequest('POST', `/v2/groups/${groupId}/messages`, {
            content: chunk,
            msg_id: msgId,
        });
        recordReply(msgId);
        if (chunks.length > 1) await sleep(500);
    }
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

// ═══════════════════════════════════════
//  WebSocket 客户端（QQ Bot 协议）
// ═══════════════════════════════════════

let seq = 0;
let sessionId = ''; // QQ 平台的 session_id（非我们的业务 session）
let heartbeatInterval = null;
let isResuming = false;

/** 保存状态（WebSocket Resume + 会话映射） */
function saveState() {
    try {
        fs.writeFileSync(
            STATE_FILE,
            JSON.stringify({
                seq,
                sessionId,
                sessionMap: Object.fromEntries(sessionMap),
                timestamp: Date.now(),
            }),
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
            // 恢复会话映射（不受 30 分钟限制）
            if (state.sessionMap) {
                for (const [key, value] of Object.entries(state.sessionMap)) {
                    sessionMap.set(key, value);
                }
                console.log(`[State] 恢复了 ${sessionMap.size} 个会话映射`);
            }
            // QQ 平台 session 超过 30 分钟不 Resume
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
                                    // intents: bit 25 = GROUP_AT_MESSAGE_CREATE, bit 30 = C2C_MESSAGE_CREATE
                                    intents: (1 << 25) | (1 << 30),
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
        const sessionKey = `c2c-${qqUserId}`;
        const sid = await getOrCreateSession(sessionKey);
        const reply = await chat(sessionKey, sid, content);
        if (!reply) return;

        await sendC2CReply(qqUserId, reply, msgId);
        console.log(`[Reply] → ${reply.substring(0, 50)}`);
    } catch (err) {
        console.error('[QQ Bot] 私聊回复失败:', err.message);
        console.error('[QQ Bot] 错误堆栈:', err.stack);
    }
}

/** 处理群聊消息（只响应 @机器人 的消息） */
async function handleGroupMessage(d) {
    const rawContent = d.content?.trim();
    const msgId = d.id;
    const qqUserId = d.author?.id;
    const groupId = d.group_id;

    if (!rawContent || !qqUserId || !msgId || !groupId) return;
    if (isDuplicate(msgId)) {
        console.log(`[Dedup] 跳过重复消息: ${msgId}`);
        return;
    }

    // 过滤 @机器人 前缀（QQ 群消息中 @bot 会带在 content 里）
    // 去掉 @机器人 的 mention 标记后才是真实消息内容
    const content = rawContent.replace(/<@!?\d+>/g, '').trim();
    if (!content) {
        console.log(`[Group] 空消息（纯@），跳过`);
        return;
    }

    console.log(`[Group:${groupId}] ${d.author?.username || qqUserId}: ${content}`);

    if (!canReply(msgId)) {
        console.log(`[Rate] 已达回复上限，跳过: ${msgId}`);
        return;
    }

    try {
        // 群聊会话按 群+用户 维度隔离（同一群里不同用户各有独立对话）
        const sessionKey = `group-${groupId}-${qqUserId}`;
        const sid = await getOrCreateSession(sessionKey);
        const reply = await chat(sessionKey, sid, content);
        if (!reply) return;

        await sendGroupReply(groupId, reply, msgId);
        console.log(`[Reply:Group] → ${reply.substring(0, 50)}`);
    } catch (err) {
        console.error('[QQ Bot] 群聊回复失败:', err.message);
    }
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
