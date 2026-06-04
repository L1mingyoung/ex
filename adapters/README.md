# AI Companion - 平台适配器

核心 API 逻辑在 `client/js/api.js`（纯 HTTP 调用，无 DOM 依赖）。
这里放各平台的 HTTP 客户端适配层，只需替换网络请求方式。

## 适配方式

| 平台 | 网络请求 | 适配文件 |
|------|---------|---------|
| Web 浏览器 | `fetch()` | `client/js/api.js` ✅ |
| 微信小程序 | `wx.request()` | `adapters/miniprogram/api.js` |
| uni-app (跨端) | `uni.request()` | `adapters/miniprogram/api-uni.js` |
| React Native | `fetch()` (同 Web) | 直接用 `client/js/api.js` |
| QQ Bot | WebSocket / HTTP | `adapters/qq-bot/adapter.js` |
| Telegram Bot | `fetch()` (Node.js 18+) | `adapters/telegram/bot.js` |

## 使用方式

```javascript
// Web / React Native
import * as API from './client/js/api.js';

// 微信小程序
import * as API from './adapters/miniprogram/api.js';

// uni-app
import * as API from './adapters/miniprogram/api-uni.js';
```

所有适配器的函数签名完全一致（createCharacter, sendMessageStream 等），
切换平台只需改 import 路径。
