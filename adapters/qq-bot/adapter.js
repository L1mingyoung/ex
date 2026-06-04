/**
 * QQ Bot 适配器（占位，需要 QQ Bot SDK）
 *
 * QQ 官方 Bot 平台: https://q.qq.com
 *
 * 架构：
 *   QQ 用户消息 → QQ WebSocket → 本适配器 → NestJS API → DeepSeek → 返回
 *
 * 使用方法（伪代码）：
 *
 *   const { createBot } = require('qq-official-bot');
 *   const bot = createBot({ appId, token, secret });
 *
 *   bot.on('message', async (msg) => {
 *     // 调我们的 API
 *     const reply = await fetch(`http://localhost:3000/api/chat/${sessionId}`, {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify({ content: msg.content }),
 *     });
 *     const data = await reply.json();
 *
 *     // 回复 QQ 用户
 *     await bot.sendMessage(msg.channelId, {
 *       content: data.reply,
 *     });
 *   });
 */

// 实际使用时需要:
// 1. npm install qq-official-bot
// 2. 在 QQ 开放平台注册 Bot 获取 appId + token
// 3. 管理 session → QQ 用户的映射关系
// 4. 部署到公网服务器（QQ 需要回调你的 WebSocket 地址）
