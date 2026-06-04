# AI Companion - 平台适配器

核心 API 逻辑在 `web/src/api/index.ts`（纯 TypeScript HTTP 调用，零框架依赖，不含 React/JSX）。
这里放各平台的 HTTP 客户端适配层，只需替换网络请求方式。

## 适配方式

| 平台 | 网络请求 | 适配文件 |
|------|---------|---------|
| Web 浏览器 | `fetch()` | `web/src/api/index.ts` ✅ |
| 微信小程序 | `wx.request()` | `adapters/miniprogram/api.js` |
| uni-app (跨端) | `uni.request()` | `adapters/miniprogram/api-uni.js` |
| React Native | `fetch()` (同 Web) | 直接用 `web/src/api/index.ts` |
| QQ Bot | WebSocket / HTTP | `adapters/qq-bot/adapter.js` |
| Telegram Bot | `fetch()` (Node.js 18+) | `adapters/telegram/bot.js` |

## API 函数签名

所有适配器导出相同签名的函数，切换平台只需改 import 路径：

```typescript
// Character CRUD
createCharacter(payload: CreateCharacterPayload): Promise<CharacterData>
getCharacters(): Promise<CharacterData[]>
getCharacter(id: string): Promise<CharacterData>
updateCharacter(id: string, data: UpdateCharacterPayload): Promise<CharacterData>
deleteCharacter(id: string): Promise<void>

// Session CRUD
createSession(payload: CreateSessionPayload): Promise<SessionData>
getSessions(): Promise<SessionData[]>
getSession(id: string): Promise<SessionData>
deleteSession(id: string): Promise<void>

// Chat
sendMessage(sessionId: string, payload: SendMessagePayload): Promise<SendMessageResponse>
sendMessageStream(sessionId: string, payload: SendMessagePayload, callbacks: SSECallbacks): AbortController
```

## 使用方式

```javascript
// Web / React (直接 import)
import * as API from '../web/src/api/index';

// 微信小程序 (复制 api/index.ts 后替换 fetch → wx.request)
import * as API from './adapters/miniprogram/api.js';

// uni-app
import * as API from './adapters/miniprogram/api-uni.js';
```

## 适配器开发指引

基于 `web/src/api/index.ts` 创建适配器：
1. 复制 `web/src/api/index.ts` 到对应适配器目录
2. 替换 `fetch()` 为平台专用 HTTP 客户端
3. 保持所有函数签名不变
4. 类型定义从 `shared/types.ts` 引用

> 旧的 `client/js/api.js` 已迁移到 `web/src/api/index.ts`（TypeScript + 完整类型）。
