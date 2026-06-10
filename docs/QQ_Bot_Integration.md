# QQ Bot 接入指南

> **版本：** v2.1 | **最后更新：** 2025-06  
> **状态：** 已完成，私聊/群聊均已调通

---

## 一、整体架构

```
QQ 用户发消息
    ↓
QQ 开放平台 WebSocket 网关（沙箱 / 正式）
    ↓
QQ Bot 适配器 (adapters/qq-bot/index.js)
    ↓ HTTP API 调用
NestJS 后端 (api:3000)
    ↓
DeepSeek LLM 生成回复
    ↓
适配器通过 QQ API 发送回复到 QQ
```

适配器是一个独立的 Node.js 进程，不依赖 NestJS 运行时，仅通过 HTTP API 与之通信。

---

## 二、前置准备

### 2.1 注册 QQ 开放平台

1. 访问 [QQ 开放平台](https://q.qq.com) 注册开发者账号
2. 创建机器人应用（个人/企业主体均可）
3. 获取凭证：

| 凭证          | 说明                              |
| ------------- | --------------------------------- |
| **AppID**     | 机器人 ID，必须使用               |
| **AppSecret** | 机器人密钥，用于获取 Access Token |
| ~~Token~~     | 已废弃，不要使用                  |

4. 在「开发设置」中开启沙箱模式进行测试

### 2.2 配置 `.env`

```env
# QQ Bot 凭证（来自 QQ 开放平台）
QQ_BOT_APP_ID=1904121817
QQ_BOT_APP_SECRET=你的AppSecret

# 沙箱模式（1=沙箱网关，0=正式网关）
QQ_BOT_SANDBOX=1

# AI Companion 系统内角色 ID（通过 API 或 Web 创建后填入）
QQ_CHARACTER_ID=sh1velen

# API 地址（本地开发用 localhost，Docker 用 api）
API_BASE=http://localhost:3000
```

> **注意：** `.env` 值不要加引号，否则引号会被当作值的一部分。

### 2.3 确保服务运行

| 服务            | 端口  | 启动命令                                               |
| --------------- | ----- | ------------------------------------------------------ |
| NestJS 后端     | 3000  | `npm run start:dev`                                    |
| Python 向量服务 | 8000  | `MOCK_EMBEDDING=1 uv run uvicorn main:app --port 8000` |
| PostgreSQL      | 55432 | Docker 容器                                            |

---

## 三、角色 ID 对应关系

`QQ_CHARACTER_ID` **不是** QQ 平台提供的 ID，而是 AI Companion 系统内的角色 ID。

| 概念                | 来源                    | 示例值       |
| ------------------- | ----------------------- | ------------ |
| `QQ_BOT_APP_ID`     | QQ 开放平台注册 Bot     | `1904121817` |
| `QQ_BOT_APP_SECRET` | QQ 开放平台             | 密钥字符串   |
| `QQ_CHARACTER_ID`   | AI Companion 系统内角色 | `sh1velen`   |

角色 ID 对应数据库 `characters` 表的主键 `id` 字段。所有 QQ Bot 的会话都绑定到此角色，AI 以该角色的人设回复。

**查看已有角色：**

```bash
curl http://localhost:3000/api/characters
```

---

## 四、WebSocket 鉴权流程

### 4.1 Access Token 获取

```
POST https://bots.qq.com/app/getAppAccessToken
Body: { "appId": "...", "clientSecret": "..." }
Response: { "access_token": "...", "expires_in": "7200" }
```

- 有效期约 2 小时（7200 秒）
- 适配器提前 1 小时自动刷新
- 缓存在内存中，不重复请求

### 4.2 连接与鉴权

```
1. 连接网关 wss://sandbox.api.sgroup.qq.com/websocket
2. 收到 Op 10 (Hello) → 获取心跳间隔
3. 发送 Op 2 (Identify) → 鉴权
4. 收到 Op 0 + READY → 鉴权成功
5. 按间隔发送 Op 1 心跳维持连接
```

### 4.3 鉴权格式（关键）

```json
{
  "op": 2,
  "d": {
    "token": "QQBot {AccessToken}",
    "intents": 1073741824,
    "shard": [0, 1]
  }
}
```

> **重要：** token 格式为 `QQBot ${accessToken}`，纯 token 不带 AppID。旧格式 `QQBot ${AppID}.${token}` 已废弃，使用旧格式会导致 **4004 鉴权失败**。

### 4.4 Intents 权限位

```javascript
intents: (1 << 25) | (1 << 30);
```

| 位  | 计算                 | 事件                               |
| --- | -------------------- | ---------------------------------- |
| 25  | 1 << 25 = 33554432   | GROUP_AT_MESSAGE_CREATE（群@消息） |
| 30  | 1 << 30 = 1073741824 | C2C_MESSAGE_CREATE（私聊消息）     |

> **必须同时设置两个位**，否则只能收到群消息或只能收到私聊消息。

### 4.5 断线恢复（Resume）

30 分钟内断线重连使用 Op 6 Resume，不丢消息：

```json
{
  "op": 6,
  "d": {
    "token": "QQBot {AccessToken}",
    "session_id": "之前 READY 事件中的 session_id",
    "seq": "最后收到的序列号 s"
  }
}
```

超过 30 分钟则重新鉴权（Op 2 Identify）。

---

## 五、消息处理流程

### 5.1 消息事件

| 事件                      | 处理函数               | 会话 Key                |
| ------------------------- | ---------------------- | ----------------------- |
| `C2C_MESSAGE_CREATE`      | `handleC2CMessage()`   | `c2c-{用户ID}`          |
| `GROUP_AT_MESSAGE_CREATE` | `handleGroupMessage()` | `group-{群ID}-{用户ID}` |

- **私聊**：每个 QQ 用户对应一个独立会话
- **群聊**：同一群里不同用户各有独立对话（按群+用户维度隔离）

### 5.2 处理步骤

```
收到消息事件
    ↓
消息去重（msgId 幂等检查）
    ↓
频率限制检查（5 分钟内最多 2 条被动回复）
    ↓
获取或创建会话（sessionMap 查找 / POST /api/sessions）
    ↓
调用 NestJS 聊天 API（POST /api/chat/{sessionId}）
    ↓
获取 AI 回复
    ↓
通过 QQ API 发送回复到 QQ
```

### 5.3 发送回复

**私聊：**

```
POST https://(sandbox.)api.sgroup.qq.com/v2/users/{userId}/messages
Authorization: QQBot {AccessToken}
Body: { "content": "回复内容", "msg_id": "原消息ID" }
```

**群聊：**

```
POST https://(sandbox.)api.sgroup.qq.com/v2/groups/{groupId}/messages
Authorization: QQBot {AccessToken}
Body: { "content": "回复内容", "msg_id": "原消息ID" }
```

- 被动回复**必须**携带 `msg_id`
- 长消息自动按 2000 字符分段发送
- 多段之间间隔 500ms 避免被限流

---

## 六、会话持久化

### 6.1 问题

`sessionMap`（QQ 用户 → NestJS sessionId）存在内存中，Bot 重启后丢失，导致所有用户对话重新开始。

### 6.2 解决方案

将会话映射持久化到 `.qq-bot-state.json` 文件：

```json
{
  "seq": 123,
  "sessionId": "QQ平台session_id",
  "sessionMap": {
    "c2c-2CB1593ED1DC7CDE": "nest-session-uuid-xxx",
    "group-12345-ABCDEF": "nest-session-uuid-yyy"
  },
  "timestamp": 1717900000000
}
```

### 6.3 保存与恢复机制

| 函数          | 调用时机                     | 说明                                        |
| ------------- | ---------------------------- | ------------------------------------------- |
| `saveState()` | 新会话创建、收到事件、断线时 | 将 seq + sessionId + sessionMap 写入文件    |
| `loadState()` | 启动时调用                   | sessionMap **永久恢复**（不受 30 分钟限制） |

- QQ 平台的 `session_id`（用于 Resume）：超过 30 分钟不恢复，重新鉴权
- 业务 `sessionMap`（用户会话映射）：**永久恢复**，不受时间限制

### 6.4 Docker 中的状态文件

容器内路径：`/app/adapters/qq-bot/.qq-bot-state.json`

如需持久化到宿主机，可在 `docker-compose.prod.yml` 中添加 volume 映射：

```yaml
volumes:
  - qqbot-state:/app/adapters/qq-bot
```

---

## 七、Opcode 速查表

| op  | 含义                        | 方向 | 说明                     |
| --- | --------------------------- | ---- | ------------------------ |
| 0   | Dispatch（事件分发）        | 下行 | 包含 READY、消息事件等   |
| 1   | Heartbeat（心跳）           | 上行 | 定期发送维持连接         |
| 2   | Identify（鉴权）            | 上行 | 首次连接时发送           |
| 6   | Resume（恢复连接）          | 上行 | 断线 30 分钟内重连时发送 |
| 7   | Reconnect（平台要求重连）   | 下行 | 收到后立即断开并重连     |
| 9   | Invalid Session（鉴权失败） | 下行 | 清除状态后重新连接       |
| 10  | Hello（心跳间隔）           | 下行 | 连接后第一条消息         |
| 11  | Heartbeat ACK               | 下行 | 心跳确认                 |

**常见错误码（WebSocket close code）：**

| code | 含义         | 处理                      |
| ---- | ------------ | ------------------------- |
| 4004 | 鉴权失败     | 检查 token 格式和 intents |
| 4009 | Rate Limited | 降低发送频率              |

---

## 八、部署方式

### 8.1 本地开发

```bash
node adapters/qq-bot/index.js
```

### 8.2 Docker 部署

通过 `docker-compose.prod.yml` 的 `qqbot` profile 启动：

```bash
docker compose -f docker-compose.prod.yml --profile qqbot up -d
```

查看日志：

```bash
docker logs -f companion-qqbot
```

### 8.3 服务器更新流程

```bash
# 1. 更新 .env（如改角色 ID）→ 不需要重建镜像，重启即可
nano ~/ex/.env
docker compose -f docker-compose.prod.yml --profile qqbot up -d

# 2. 更新代码 → 需要重建镜像（务必加 --no-cache 避免旧代码残留）
docker build --no-cache -t companion-api:latest .
docker compose -f docker-compose.prod.yml --profile qqbot down
docker compose -f docker-compose.prod.yml --profile qqbot up -d --build
```

### 8.4 沙箱 vs 正式环境

| 环境 | 网关地址                                    | API Host                    | 限制                  |
| ---- | ------------------------------------------- | --------------------------- | --------------------- |
| 沙箱 | `wss://sandbox.api.sgroup.qq.com/websocket` | `sandbox.api.sgroup.qq.com` | 只能在沙箱群/频道使用 |
| 正式 | `wss://api.sgroup.qq.com/websocket`         | `api.sgroup.qq.com`         | 需要审核通过          |

---

## 九、常见问题排查

### Q1: 反复 4004 鉴权失败

**原因 1：** Token 格式错误

- 错误：`QQBot ${AppID}.${token}`（旧格式）
- 正确：`QQBot ${accessToken}`（纯 token）

**原因 2：** Intents 配置错误

- 必须同时包含 `(1 << 25) | (1 << 30)`

**原因 3：** Docker 缓存了旧镜像

- 解决：`docker build --no-cache` 重新构建

**验证方法（在容器中检查代码）：**

```bash
docker exec -it companion-qqbot grep -A 3 'function authHeader' /app/adapters/qq-bot/index.js
# 正确输出：return `QQBot ${accessToken}`;

docker exec -it companion-qqbot grep -A 2 'intents' /app/adapters/qq-bot/index.js
# 正确输出：intents: (1 << 25) | (1 << 30),
```

### Q2: 收到消息但没有回复

- 检查 NestJS 日志是否有 500 错误
- 确认 `QQ_CHARACTER_ID` 对应的角色存在：`curl http://localhost:3000/api/characters`
- 确认 QQ API 鉴权头正确（与 WebSocket 相同格式）

### Q3: QQ 端收不到回复（日志显示已回复）

- 检查 QQ API HTTP 状态码（>= 400 表示发送失败）
- 确认 `Authorization` 头使用的是 `authHeader()` 而非硬编码旧格式
- 确认被动回复携带了 `msg_id`

### Q4: 重启后会话丢失

- 确认 `.qq-bot-state.json` 存在且可写
- 确认 `loadState()` 输出 `恢复了 X 个会话映射`
- Docker 中状态文件在容器内，重启容器会丢失，需挂载 volume 或接受重建会话

---

## 十、频率限制

| 类型     | 限制                             |
| -------- | -------------------------------- |
| 被动回复 | 收到消息后 5 分钟内最多回复 2 条 |
| 主动消息 | 每天有固定限额（根据机器人等级） |
| 单条消息 | 最大 2000 字符，超出自动分段     |

---

## 十一、功能检查清单

### 已完成

- [x] WebSocket 连接网关 + 心跳维持
- [x] Access Token 鉴权（非旧 Token 方式）
- [x] Op 6 Resume 断线恢复
- [x] 接收私聊消息（C2C_MESSAGE_CREATE）
- [x] 接收群@消息（GROUP_AT_MESSAGE_CREATE）
- [x] 调 NestJS API 获取 AI 回复
- [x] 私聊 / 群聊回复发送
- [x] 消息去重（幂等处理）
- [x] 频率限制控制（5 分钟内最多 2 条）
- [x] 长消息自动分段
- [x] 断线自动重连（5 秒后）
- [x] 会话映射持久化（`.qq-bot-state.json`）
- [x] Docker 容器化部署
- [x] HTTP API 状态码校验与错误日志
- [x] 空值防御（emotion service 兜底）

### 待扩展

- [ ] 富文本支持（图片、表情、Markdown）
- [ ] 错误退避重试
- [ ] 多角色切换（根据指令切换角色）
- [ ] 正式环境审核与上线
