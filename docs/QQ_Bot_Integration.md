# QQ Bot 接入指南

## 概述

将 AI Companion 接入 QQ，让用户通过 QQ 私聊或群聊与 AI 角色对话。

**当前状态：** 已有基础适配器 `adapters/qq-bot/index.js`，采用原生 WebSocket 实现，需要进一步完善。

---

## 一、前置准备

### 1.1 注册 QQ 开放平台

1. 访问 [QQ 开放平台](https://q.qq.com) 注册开发者账号
2. 创建机器人应用（个人/企业主体均可）
3. 获取以下凭证：

| 凭证          | 说明                              |
| ------------- | --------------------------------- |
| **AppID**     | 机器人 ID，必须使用               |
| **AppSecret** | 机器人密钥，用于获取 Access Token |
| ~~Token~~     | 已弃用，不要使用                  |

4. 在「开发设置」中配置沙箱/正式环境

### 1.2 配置 `.env`

```env
# QQ Bot
QQ_BOT_APP_ID=你的AppID
QQ_BOT_APP_SECRET=你的AppSecret
QQ_CHARACTER_ID=ai角色ID
```

### 1.3 确保服务运行

| 服务            | 端口  | 启动命令                                               |
| --------------- | ----- | ------------------------------------------------------ |
| NestJS 后端     | 3000  | `npm run start:dev`                                    |
| Python 向量服务 | 8000  | `MOCK_EMBEDDING=1 uv run uvicorn main:app --port 8000` |
| PostgreSQL      | 55432 | Docker 容器                                            |

---

## 二、接入方式对比

### 方式 A：原生 WebSocket（当前方案）

直接用 `ws` 库连接 QQ 网关，零依赖，当前 `index.js` 已实现基础框架。

**优点：** 无额外依赖，轻量，完全可控  
**缺点：** 需要自己处理心跳、重连、分片、鉴权等底层逻辑

### 方式 B：官方 NodeSDK（推荐升级）

```bash
npm install qq-guild-bot
```

**优点：** 官方维护，封装了鉴权/心跳/重连，API 更简洁  
**缺点：** 多一层依赖

### 方式 C：社区 SDK `qq-bot-sdk`

```bash
npm install qq-bot-sdk
```

**优点：** 支持 webhook + websocket 两种模式，群消息支持更完善  
**缺点：** 社区维护，更新频率不确定

---

## 三、WebSocket 协议详解（当前方案基础）

### 3.1 连接流程

```
1. 获取网关地址 → GET /gateway/bot → wss://api.sgroup.qq.com/websocket/
2. 建立 WebSocket 连接
3. 收到 Op 10 Hello（含心跳间隔）
4. 发送 Op 2 Identify（鉴权）
5. 收到 READY 事件（鉴权成功）
6. 按周期发送 Op 1 心跳
7. 接收 Op 0 Dispatch 事件（消息等）
```

### 3.2 Payload 结构

```json
{
  "op": 0, // opcode 操作码
  "d": {}, // 事件数据
  "s": 42, // 序列号（心跳用）
  "t": "EVENT" // 事件类型（仅 op=0 时）
}
```

### 3.3 Opcode 表

| op  | 含义                        | 方向 |
| --- | --------------------------- | ---- |
| 0   | Dispatch（事件分发）        | 下行 |
| 1   | Heartbeat（心跳）           | 上行 |
| 2   | Identify（鉴权）            | 上行 |
| 6   | Resume（恢复连接）          | 上行 |
| 7   | Reconnect（平台要求重连）   | 下行 |
| 9   | Invalid Session（鉴权失败） | 下行 |
| 10  | Hello（心跳间隔）           | 下行 |
| 11  | Heartbeat ACK               | 下行 |

### 3.4 鉴权格式

```json
{
  "op": 2,
  "d": {
    "token": "QQBot {AppID}.{AccessToken}",
    "intents": 33554432,
    "shard": [0, 1]
  }
}
```

> **注意：** Token 鉴权方式已废弃，需要使用 Access Token（通过 AppSecret 获取）。

### 3.5 Intents 权限位

| 位  | 值                 | 事件                               |
| --- | ------------------ | ---------------------------------- |
| 25  | 1 << 25 = 33554432 | C2C_MESSAGE_CREATE（私聊消息）     |
| 25  | 1 << 25            | GROUP_AT_MESSAGE_CREATE（群@消息） |

### 3.6 断线重连

断开后发送 Op 6 Resume 而非重新鉴权：

```json
{
  "op": 6,
  "d": {
    "token": "QQBot {AppID}.{AccessToken}",
    "session_id": "之前READY事件中的session_id",
    "seq": 最后收到的s值
  }
}
```

---

## 四、消息收发 API

### 4.1 接收消息事件

**私聊：** `C2C_MESSAGE_CREATE`  
**群聊@：** `GROUP_AT_MESSAGE_CREATE`

事件数据结构：

```json
{
  "op": 0,
  "t": "C2C_MESSAGE_CREATE",
  "d": {
    "id": "消息ID",
    "content": "消息内容",
    "author": {
      "id": "用户ID",
      "username": "用户名"
    }
  }
}
```

### 4.2 发送回复

**私聊回复：**

```
POST https://api.sgroup.qq.com/v2/users/{userId}/messages
```

**群聊回复：**

```
POST https://api.sgroup.qq.com/v2/groups/{groupId}/messages
```

请求头：

```
Authorization: QQBot {AppID}.{AccessToken}
Content-Type: application/json
```

请求体：

```json
{
  "content": "回复内容",
  "msg_id": "原消息ID（被动回复必须带）"
}
```

> **重要：** 被动回复必须携带 `msg_id`，否则会发送失败。

---

## 五、当前适配器代码分析

文件：`adapters/qq-bot/index.js`

### 已实现

- [x] WebSocket 连接网关
- [x] 心跳维持
- [x] 鉴权（AppID + Token）
- [x] 接收私聊/群@消息
- [x] 调 NestJS API 获取 AI 回复
- [x] 回复到 QQ 用户
- [x] 断线自动重连（5秒后）
- [x] 会话映射（QQ 用户 → sessionId）

### 需要完善

- [ ] **Access Token 鉴权**：当前用的是旧 Token 方式，需改为 OAuth2 Access Token
- [ ] **断线恢复（Resume）**：当前是重新连接+鉴权，应改为 Op 6 Resume 补发遗漏消息
- [ ] **seq 持久化**：重启后丢失 seq，应存到文件/Redis
- [ ] **群聊回复 API**：当前只有私聊回复路径，群聊路径不同
- [ ] **消息去重**：QQ 平台可能重复推送，需做幂等处理
- [ ] **错误重试**：API 调用失败后的退避重试
- [ ] **富文本支持**：图片、表情、Markdown 格式消息
- [ ] **消息频率限制**：QQ 平台有发送频率限制，需加队列

---

## 六、升级方案：改用官方 NodeSDK

### 6.1 安装

```bash
npm install qq-guild-bot
```

### 6.2 基础用法示例

```javascript
const { createOpenAPI, createWebsocket } = require('qq-guild-bot');

const bot = createWebsocket({
  appID: process.env.QQ_BOT_APP_ID,
  token: process.env.QQ_BOT_TOKEN, // 新版 SDK 可能已适配 Access Token
  intents: ['C2C_MESSAGE_CREATE', 'GROUP_AT_MESSAGE_CREATE'],
});

bot.on('C2C_MESSAGE_CREATE', async (event) => {
  const msg = event.msg;

  // 调用 AI Companion API
  const reply = await callCompanionAPI(msg.author.id, msg.content);

  // 回复
  const api = createOpenAPI({
    appID: process.env.QQ_BOT_APP_ID,
    token: process.env.QQ_BOT_TOKEN,
  });

  await api.messageApi.postMessage(msg.author.id, {
    content: reply,
    msg_id: msg.id,
  });
});
```

### 6.3 与现有 NestJS API 对接

```javascript
async function callCompanionAPI(qqUserId, content) {
  // 获取或创建会话
  let sessionId = sessionMap.get(qqUserId);
  if (!sessionId) {
    const res = await fetch(`${API_BASE}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        characterId: CHARACTER_ID,
        title: `QQ-${qqUserId}`,
      }),
    });
    const session = await res.json();
    sessionId = session.id;
    sessionMap.set(qqUserId, sessionId);
  }

  // 发送消息（非流式）
  const res = await fetch(`${API_BASE}/api/chat/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  const data = await res.json();
  return data.reply;
}
```

---

## 七、部署注意事项

### 7.1 网络要求

- QQ 网关地址 `wss://api.sgroup.qq.com` 需要能访问外网
- 如果在大陆服务器，无需额外代理
- QQ API 的 HTTPS 请求需要能正常访问

### 7.2 沙箱 vs 正式环境

| 环境 | 网关地址                                    | 限制                  |
| ---- | ------------------------------------------- | --------------------- |
| 沙箱 | `wss://sandbox.api.sgroup.qq.com/websocket` | 只能在沙箱频道/群使用 |
| 正式 | `wss://api.sgroup.qq.com/websocket`         | 需要审核通过          |

### 7.3 频率限制

- 被动回复：收到消息后 **5 分钟内** 可回复，最多 **2 条**
- 主动消息：每天有限额（根据机器人等级）
- 建议加消息队列，避免超限被封

### 7.4 进程管理

```bash
# 使用 pm2 守护进程
npm install -g pm2
pm2 start adapters/qq-bot/index.js --name qq-bot
pm2 save
```

或者集成到 `start.bat` 中一起启动。

---

## 八、开发检查清单

- [ ] 在 QQ 开放平台注册并创建机器人
- [ ] 获取 AppID + AppSecret，填入 `.env`
- [ ] 沙箱环境测试通过
- [ ] 改用 Access Token 鉴权（旧 Token 已废弃）
- [ ] 实现 Op 6 Resume 断线恢复
- [ ] 群聊回复 API 补充
- [ ] 消息去重（幂等）
- [ ] 消息队列（频率限制）
- [ ] 提交正式环境审核
- [ ] 部署到公网服务器 + pm2 守护
