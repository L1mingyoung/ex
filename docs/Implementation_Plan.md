# AI 伴侣后端 —— 实施方案

> 对照学习笔记：[Learning_Notes.md](Learning_Notes.md)
> 基于规格文档：[AI_Companion_最终方案.md](AI_Companion_最终方案.md)

---

## 技术栈

| 层级 | 技术 | 状态 |
|------|------|------|
| 主框架 | NestJS 11 + TypeScript 5.9 | ✅ |
| 数据库 | PostgreSQL 15 + pgvector 0.5.1 (Docker) | ✅ |
| ORM | TypeORM 1.0 (ESM-only) | ✅ |
| Python 包管理 | uv 0.11.7 | ✅ |
| Embedding | Python FastAPI + ONNX Runtime（Mock + 真实 ONNX） | ✅ |
| LLM | DeepSeek API | ✅ |
| 前端 | React/Vite Web 前端（SSE 流式） | ✅ 迁移中 |
| 版本管理 | Git + GitHub | ✅ |

---

## 当前进度

| Day | 内容 | 状态 |
|-----|------|------|
| Day 1 | 项目初始化 + Docker pgvector + 数据库连接 | ✅ |
| Day 2 | Entity + Characters/Sessions CRUD | ✅ |
| Day 3 | Messages + LlmService + ChatService 基础对话 | ✅ |
| Day 4 | Python FastAPI + EmbeddingService (Mock) | ✅ |
| Day 5 | MemoriesService（向量检索 + 写入 + 查重） | ✅ |
| Day 6 | 异步记忆提取 + 滚动摘要 | ✅ |
| Day 7 | SSE 流式 + Web 前端 + 适配器 + 角色编辑 + GitHub | ✅ |
| 后续 | 小程序 / Bot 接入 / 队列化 / 多用户 | ⏳ |

---

## 目录结构

```
companion/
├── src/                          # NestJS 后端
│   ├── main.ts                   # 入口：CORS + 监听
│   ├── app.module.ts             # 根模块（含 ServeStaticModule）
│   ├── config/database.config.ts # TypeORM DataSource
│   ├── characters/               # 角色 CRUD + PUT 编辑
│   ├── sessions/                 # 会话 CRUD
│   ├── messages/                 # 消息读写
│   ├── memories/                 # 记忆向量检索（Raw SQL）
│   ├── llm/                      # DeepSeek API（同步 + SSE 流式）
│   ├── embedding/                # Python 向量服务客户端
│   └── chat/                     # 核心编排（四层 Prompt + 异步提取）
│
├── web/                          # React/Vite Web 前端（当前迁移方向）
│   ├── src/App.tsx               # 应用入口
│   ├── src/api/index.ts          # API 调用层
│   └── src/components/           # Sidebar / ChatArea 等组件
│
├── adapters/                     # 平台适配器
│   ├── miniprogram/api.js        # 微信小程序 (wx.request)
│   ├── miniprogram/api-uni.js    # uni-app 跨端 (uni.request)
│   └── qq-bot/adapter.js         # QQ Bot 适配
│
├── python/                       # Python Embedding 服务
│   ├── pyproject.toml
│   ├── main.py                   # FastAPI（/embed, /batch_embed, /health）
│   ├── embedder.py               # ONNX Runtime + tokenizer + pooling 封装
│   ├── scripts/download_model.py # 下载 ONNX + tokenizer
│   └── models/                   # 已下载真实 ONNX 模型 + tokenizer
│
├── docs/                         # 文档
│   ├── AI_Companion_最终方案.md
│   ├── Implementation_Plan.md
│   └── Learning_Notes.md
│
├── test_chat.js                  # CLI 测试脚本
├── start.bat                     # 快速启动指南
├── .env.example                  # 环境变量模板
└── package.json
```

---

## API 接口

### 业务 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/characters` | 创建角色 |
| GET | `/api/characters` | 角色列表 |
| GET | `/api/characters/:id` | 角色详情 |
| **PUT** | `/api/characters/:id` | **修改角色（名称/人格/模型）** |
| DELETE | `/api/characters/:id` | 删除角色 |
| POST | `/api/sessions` | 创建会话 |
| GET | `/api/sessions` | 会话列表 |
| GET | `/api/sessions/:id` | 会话详情 |
| DELETE | `/api/sessions/:id` | 删除会话 |
| POST | `/api/chat/:sessionId` | 发送消息（同步，等完整回复） |
| **POST** | `/api/chat/:sessionId/stream` | **发送消息（SSE 流式，逐字推送）** |

### Python 服务（内部调用）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/embed` | 单条文本 → 768 维向量 |
| POST | `/batch_embed` | 批量文本 → 多个 768 维向量 |
| GET | `/health` | 健康检查 |

---

## 数据库表

| 表名 | 管理方式 | 索引 |
|------|---------|------|
| characters | TypeORM Entity | PK(id) |
| sessions | TypeORM Entity | PK(uuid) |
| messages | TypeORM Entity | PK(bigserial), idx(session_id, created_at) |
| memory_chunks | 手动 SQL | hnsw(embedding), idx(session_id, created_at) |

### 关键设计：memory_chunks 不用 TypeORM

`embedding VECTOR(768)` 列 TypeORM 无法识别，`synchronize: true` 会删除此列。MemoriesService 直接用 `DataSource.query()` 原生 SQL。

---

## 核心数据流

```
用户发消息（Web / 小程序 / Bot / CLI）
    │
    ├── [同步] 保存用户消息 → messages 表
    ├── [同步] 读取角色 + session + 最近 10 条
    ├── [同步] 向量检索 Top-5 记忆 → Prompt 第三层
    ├── [同步] 组装四层 System Prompt
    ├── [同步] 调 DeepSeek（同步或 SSE 流式）
    ├── [同步] 保存 AI 回复 → messages 表
    ├── [同步] 更新消息计数
    └── [同步] 返回 reply / SSE 流式推送
            │
            ├── [异步] 记忆提取：LLM → 向量化 → 查重 → 入库
            └── [异步] 滚动摘要：50条+1h → 压缩历史 → session.summary
```

---

## 多端架构

```
         ┌─ import API from 'web/src/api/index.ts'          → React/Vite Web
相同函数 ─┼─ import API from 'adapters/miniprogram/api.js'    → 微信小程序
签名     └─ import API from 'adapters/miniprogram/api-uni.js' → uni-app 跨端

NestJS API 是唯一数据源，所有客户端只做展示。
```

---

## 如何启动

```bash
# 终端 1：数据库
docker start companion-pg

# 终端 2：Python Embedding（真实模型）
cd python
.\.venv\Scripts\uvicorn.exe main:app --port 8000

# 如需快速联调，也可以继续使用 Mock
MOCK_EMBEDDING=1 .\.venv\Scripts\uvicorn.exe main:app --port 8000

# 终端 3：NestJS（API + Web 前端）
cd companion
npm run start:dev
# → http://localhost:3000     Web 聊天
# → http://localhost:3000/api API
```

---

## 后续工作

| 优先级 | 任务 | 说明 |
|--------|------|------|
| 高 | jiwen 情绪引擎 | 接入情绪评分，写入 message.emotion_snapshot，并拼进 prompt | ✅ 已接入 |
| 高 | 聊天记录批量导入 | 优先支持微信格式，写入 messages，并触发摘要/记忆/画像提取 | ✅ 基础版已接入 |
| 高 | 小程序 / 移动端 App | 基于 adapters/ 开发 |
| 中 | QQ Bot / Telegram Bot | WebSocket/Webhook 适配 |
| 中 | @nestjs/bull 队列 | 异步任务进 Redis 队列 |
| 低 | 人格提取增强 | 从导入聊天记录中提炼长期人格/关系画像，并在后续聊天注入 | ✅ 已接入 |
| 远期 | 多用户系统 | users 表 + JWT |

---

## 2026-06-04 修复记录

| 问题 | 修复 | 状态 |
|------|------|------|
| 滚动摘要被 updated_at 阻断 | 新增 sessions.last_summary_at，摘要判断改用 last_summary_at；摘要成功后清零 message_count | ✅ |
| pgvector 表缺少可复现初始化 | 新增 TypeORM migration：创建 vector 扩展、基础表、memory_chunks、HNSW 索引；关闭 synchronize | ✅ |
| 真实 embedding 模型接入不完整 | 支持 EMBEDDING_MODEL_PATH；新增 python/scripts/download_model.py；保留 Mock 作为快速联调模式 | ✅ |

### 新启动建议

开发联调可以继续使用 Mock：

```bash
cd python
MOCK_EMBEDDING=1 .\.venv\Scripts\uvicorn.exe main:app --port 8000
```

切换真实 embedding：

```bash
cd python
.\.venv\Scripts\python.exe scripts\download_model.py
.\.venv\Scripts\uvicorn.exe main:app --port 8000
```

NestJS 启动时会自动执行 migration。因为 `memory_chunks.embedding` 是 `vector(768)`，以后不要再打开 `synchronize: true`。

### 真实 Embedding 下载后补充

本次真实模型下载后发现：Hugging Face 仓库里的 ONNX 文件实际路径是 `onnx/model.onnx`，不是旧脚本里假设的 `onnx/jina-embeddings-v2-base-zh.onnx`。

已修正：

- `python/scripts/download_model.py` 下载 `onnx/model.onnx`，本地保存为 `python/models/jina-embeddings-v2-base-zh.onnx`
- 同时下载 `tokenizer.json`
- `python/embedder.py` 改为真实推理链路：Tokenizer -> `input_ids` / `attention_mask` -> ONNX -> mean pooling -> L2 normalize
- `python/pyproject.toml` 增加 `tokenizers>=0.23.0`

当前真实 embedding 已验证：输入中文文本可输出 768 维向量，归一化后向量范数为 `1.0`。

---

## 当前完成/未完成对照

### 已完成

- NestJS 后端主框架、PostgreSQL/pgvector、TypeORM 基础表
- Characters / Sessions / Messages CRUD 与聊天主流程
- DeepSeek 同步与 SSE 流式响应
- Python FastAPI embedding 服务，支持 Mock 与真实 ONNX
- 真实 embedding：`onnx/model.onnx` + `tokenizer.json`，已验证输出 768 维归一化向量
- MemoriesService：向量检索、写入、查重
- 异步记忆提取与滚动摘要
- `last_summary_at` 摘要触发修复
- TypeORM migration 初始化 pgvector 扩展、`memory_chunks` 和索引
- React/Vite Web 前端目录已出现，原 `client/` 前端处于迁移状态

### 未完成 / 下一阶段

- ✅ jiwen 情绪引擎接入
- ✅ 微信聊天记录批量导入基础版
- ✅ 导入记录后的长期人格/关系画像提取：自动提取并保存到 `sessions.import_profile`
- 小程序 / 移动端 App 完整端实现
- QQ Bot / Telegram Bot 完整可部署版本
- Bull / Redis 队列替代 `setImmediate`
- 多用户系统：users、JWT、权限隔离
- 生产化部署：Docker Compose、日志、监控、重试、环境分层

### 下一阶段优先级

1. 导入链路增强：补充微信特殊消息过滤、图片/语音/撤回标记处理、导入预览确认。
2. 异步任务队列化：用 Bull / Redis 替代 `setImmediate`，给摘要、记忆、画像提取增加重试和状态查询。
3. 画像演进：增加手动重建接口、画像版本化、置信度/证据来源字段。
---

## 2026-06-04 功能更新：jiwen 情绪引擎 + 微信聊天记录导入

### jiwen 情绪引擎

已新增 `src/emotion/` 模块：

- `JiwenEmotionService.analyze(text)`：基于轻量词典和标点特征生成情绪快照
- 输出字段包括 `joy`、`sadness`、`anger`、`anxiety`、`fatigue`、`stress`、`affection`、`dominant`、`valence`、`arousal`
- 用户消息写入 `messages.emotion_snapshot`
- `ChatService.buildSystemPrompt()` 新增 `【jiwen 情绪状态】` 层，让 AI 回复先接住用户情绪

### 微信聊天记录批量导入

已新增 `src/records-import/` 模块：

- API：`POST /api/import/chat-records`
- 默认优先支持微信聊天记录格式
- 支持格式示例：

```text
2026-06-04 21:18:03 我
今天加班好累
2026-06-04 21:19:10 小雅
辛苦啦，我陪你缓一下
小雅：要不要喝点水？
```

请求示例：

```json
{
  "sessionId": "会话 UUID",
  "format": "wechat",
  "userAliases": ["我", "自己的微信名"],
  "assistantAliases": ["小雅"],
  "text": "2026-06-04 21:18:03 我\n今天加班好累"
}
```

导入后会：

- 批量写入 `messages`
- 为用户消息生成 `emotion_snapshot`
- 增加 session 的 `message_count`
- 异步触发导入记录的长期记忆提取
- 异步生成导入摘要，写入 `session.summary`

### 当前状态

| 功能 | 状态 |
|------|------|
| jiwen 情绪引擎接入 | ✅ |
| 微信聊天记录批量导入 | ✅ 基础版 |
| 导入后人格/关系画像提取 | ✅ 已接入 |


## 2026-06-04 追加：长期人格/关系画像提取已接入

- `sessions` 新增 `import_profile` / `profile_updated_at`，用于保存导入聊天记录后生成的结构化画像。
- `POST /api/import/chat-records` 默认在导入后异步触发画像提取，返回 `profileExtractionQueued`；可用 `extractProfile: false` 关闭。
- 画像包含 `userPersona` 和 `relationshipProfile` 两部分，并将关键事实、偏好、情绪/关系模式同步写入现有 `memory_chunks`。
- `ChatService.buildSystemPrompt()` 新增 `【长期人格/关系画像】` 层，和滚动摘要、动态记忆、jiwen 情绪状态一起参与后续回复。

### 当前完成状态

| 子项 | 状态 | 说明 |
|------|------|------|
| Session JSONB 画像字段 | ✅ | `import_profile` 保存结构化画像，`profile_updated_at` 保存更新时间 |
| 导入后自动触发 | ✅ | `extractProfile` 默认 true；空导入不触发 |
| LLM JSON 画像解析 | ✅ | 支持纯 JSON 和 fenced JSON；解析失败只打印日志，不阻塞导入 |
| 画像写入长期记忆 | ✅ | 复用 `fact/preference/emotion`，不新增 memory enum |
| 后续聊天提示词注入 | ✅ | 普通聊天与 SSE 流式聊天都读取 `session.importProfile` |
| 单元测试 | ✅ | 覆盖默认画像入队与 fenced JSON 解析 |

---

## 2026-06-05 功能更新：AI 情绪模型 + 角色设定增强

### MoodService — AI 自身情绪系统

已新增 `src/emotion/mood.service.ts`：

- **情绪共鸣**：AI 的情绪会受用户情绪影响，产生自然的共鸣波动
- **情绪衰减**：不会突变，每次只变化一小步，逐步回归中性
- **随机波动**：微小随机变化，模拟真人不会永远一个状态
- **二维情绪空间**：valence（愉悦度）+ arousal（活跃度）→ 8 种情绪标签
- **每个会话独立**：不同会话的 AI 情绪互不影响
- **Prompt 注入**：AI 当前情绪通过 `【你当前的情绪状态】` 注入 prompt，影响回复语气

### JiwenEmotionService 增强

- **情绪回应策略**：每种用户情绪对应具体的中文回应指导（不是"接住情绪"一句笼统的话，而是 sadness→共情不要说教，joy→一起开心可以调侃，anxiety→短句安抚别长篇大论...）
- 策略通过 `【你的回应方式】` 注入 prompt

### 角色设定双模式

导入聊天记录时可选择：

- **🔗 合并模式（默认）**：保留手动编写的 base_prompt，从记录中提取说话风格追加
- **🔄 替换模式**：用聊天记录完全重写角色人设

API：`POST /api/import/chat-records` 新增 `mode: 'merge' | 'replace'` 字段
独立端点：`POST /api/import/enrich-character/:sessionId` 接受 `{ mode: 'replace' | 'merge' }`

### 当前 Prompt 层级（6 层）

```
第一层：固定人格 (base_prompt + speech_patterns)
第二层：滚动摘要 (session.summary)
第2.5层：长期人格/关系画像 (session.importProfile)
第三层：动态记忆 (memory_chunks 向量检索)
第四层：情绪状态 (用户情绪信号 + AI 自身情绪)
第五层：严格指令约束 (禁止自曝AI、维持人设)
```

---

## 2026-06-06 Docker 部署改造

- 新增根目录 `Dockerfile`：多阶段构建 NestJS API，并构建 `web/dist` 后由后端静态服务。
- 新增 `python/Dockerfile`：独立运行 FastAPI embedding 服务，模型目录通过 volume 挂载，不把 ONNX 大文件打进镜像。
- 新增 `docker-compose.yml`：编排 `api`、`embedding`、`postgres(pgvector)` 三个服务。
- 新增 `.env.docker.example`：Docker 部署专用环境变量模板。
- 新增 `docs/Docker_Deployment.md`：记录启动、停止、模型准备和 mock embedding 测试方式。
- `docker compose config` 已通过配置解析验证。

---

## 2026-06-09 前端移动端适配 + UI 重设计

### 移动端适配方案

采用 **纯 CSS 响应式** 方案，不引入 Taro / RN 等跨端框架。理由：项目只需 H5 移动端兼容，React + CSS 响应式是最轻量高效的选择。

### 适配细节清单

#### 1. 视口与安全区域

| 优化项 | 实现 | 文件 |
|--------|------|------|
| 视口锁定 | `viewport` 禁止缩放 + `viewport-fit=cover` | `index.html` |
| iOS 全屏 | `apple-mobile-web-app-capable` + `black-translucent` 状态栏 | `index.html` |
| 主题色 | `theme-color` 匹配暗色背景 `#0d0c0e` | `index.html` |
| 安全区域 CSS 变量 | `--safe-top/bottom/left/right` = `env(safe-area-inset-*)` | `index.css` |
| 动态视口高度 | `100dvh` 替代 `100vh`（解决 iOS 地址栏缩放问题） | `index.css` |
| 禁止过度滚动 | `overscroll-behavior: none` | `index.css` |
| 禁止文字自动调整 | `-webkit-text-size-adjust: 100%` | `index.css` |
| 禁止点击高亮 | `-webkit-tap-highlight-color: transparent` | `index.css` |

#### 2. 侧边栏 → 抽屉式导航

| 优化项 | 实现 | 文件 |
|--------|------|------|
| 桌面端 | 固定左侧 300px 侧边栏 | `index.css` |
| 移动端 | `position: fixed` 抽屉，`translateX(-100%)` 隐藏 | `index.css` |
| 抽屉宽度 | `85vw`，最大 `360px` | `index.css` |
| 滑入动画 | `transform` + `transition` + `ease-out` 曲线 | `index.css` |
| 遮罩层 | `sidebar-overlay` 半透明 + `backdrop-filter: blur(6px)` | `index.css` / `App.tsx` |
| 关闭按钮 | `.sidebar-close-btn` 仅移动端显示 | `Sidebar.css` |
| 安全区域 | 抽屉内 `padding-top/bottom` 加 `var(--safe-*)` | `index.css` |
| 选择后自动关闭 | `handleSelectSession` 调用 `setSidebarOpen(false)` | `App.tsx` |

#### 3. 聊天区域移动端适配

| 优化项 | 实现 | 文件 |
|--------|------|------|
| 汉堡菜单 | `.menu-btn` 仅移动端 `display: flex` | `ChatArea.css` / `ChatHeader.tsx` |
| 消息气泡宽度 | 桌面 `max-width: 72%` → 移动 `88%` | `ChatArea.css` / `index.css` |
| 输入框字体 | 移动端 `font-size: 16px`（防止 iOS 自动缩放） | `index.css` |
| 输入框自适应高度 | `useEffect` 监听 `text` 变化，动态设置 `height` | `InputArea.tsx` |
| 输入区安全区域 | `padding-bottom: calc(10px + var(--safe-bottom))` | `index.css` |
| 聊天区安全区域 | `padding-top: var(--safe-top)` | `index.css` |
| 触摸滚动 | `-webkit-overflow-scrolling: touch` | `ChatArea.css` |

#### 4. 模态框移动端适配

| 优化项 | 实现 | 文件 |
|--------|------|------|
| 全屏模态 | 移动端 `width: 100%` + `height: 100dvh` + `border-radius: 0` | `index.css` |
| 安全区域 | `padding` 加 `var(--safe-top/bottom)` | `index.css` |
| 表单字体 | `font-size: 16px`（防止 iOS 缩放） | `ChatArea.css` |
| 按钮触摸区 | `min-height: 44px`（Apple HIG 最小触摸目标） | `ChatArea.css` |
| 别名输入 | 移动端 `grid-template-columns: 1fr`（单列） | `index.css` |

#### 5. 交互细节

| 优化项 | 实现 | 文件 |
|--------|------|------|
| 删除按钮 | 移动端 `opacity: 0.4` 常显（无 hover） | `Sidebar.css` |
| 编辑按钮 | 移动端 `opacity: 0.5` 常显 | `Sidebar.css` |
| 按钮按压反馈 | `:active { transform: scale(0.92~0.98) }` | 多处 CSS |
| 聚焦环 | `box-shadow: 0 0 0 3px var(--accent-soft)` | 多处 CSS |

### UI 重设计

| 维度 | 旧设计 | 新设计 |
|------|--------|--------|
| 色彩 | 冷蓝黑 + 紫色渐变 | 暖调暗色 + 珊瑚色 `#d4764e` |
| 字体 | 系统默认 | Space Grotesk（标题）+ DM Sans（正文） |
| 气泡 | 紫色渐变用户 + 白色 AI | 珊瑚色用户 + 暗色半透明 AI |
| 氛围 | 冷冰冰工具感 | 温馨夜间聊天空间 |
| 装饰 | 过度玻璃拟态 + 多层阴影 | 聊天区顶部微妙暖光晕 |
| 模态框 | 白色背景 | 统一暗色背景 |
| 动效 | 脉冲动画 | 克制闪烁光标 + 柔和淡入 |

### 色板体系

```
背景层级: #0d0c0e → #161518 → #1e1c21 → #252329
前景层级: #e8e2d9 → #a09a92 → #6b665f
主色调:   #d4764e → #e08a64 (珊瑚色)
辅助色:   #7c6faa (淡紫，仅预览标记)
边框:     rgba(255,255,255, 0.06~0.12)
```

### 当前状态

| 功能 | 状态 |
|------|------|
| 视口 + 安全区域适配 | ✅ |
| 抽屉式侧边栏 | ✅ |
| 聊天区移动端适配 | ✅ |
| 输入框自适应高度 | ✅ |
| 模态框全屏适配 | ✅ |
| 触摸交互优化 | ✅ |
| UI 暗色主题重设计 | ✅ |

---

## 2026-06-09 H5 完善：交互增强 + 样式补全

### 变更内容

| 变更项 | 说明 | 状态 |
|--------|------|------|
| 停止生成按钮 | 流式输出时可中断，AbortController 取消请求 | ✅ |
| 消息时间戳 | 每条消息显示发送时间（hover 显示） | ✅ |
| Toast 通知样式 | 补全 Toast 组件的 CSS（成功/错误/信息三种类型） | ✅ |
| 空状态提示样式 | 补全 `.empty-hint` CSS | ✅ |
| AI 头像 + 消息布局重构 | 消息气泡改为 flex 布局，AI 消息带头像 | ✅ |
| 流式状态指示器 | Header 中显示脉冲圆点表示正在生成 | ✅ |
| 编辑角色模态框 | 删除按钮样式优化，红色危险风格 | ✅ |
| 导入模态框 radio 样式 | 补全 `.import-radio` / `.import-radio-label` CSS | ✅ |
| 项目规则文件 | 新增 `.trae/rules/project_rules.md` | ✅ |

### 停止生成按钮实现

- `AppContext` 新增 `STOP_STREAM` action 和 `stopStreaming()` 方法
- `stopStreaming()` 调用 `AbortController.abort()` 取消 SSE 请求
- 如果 AI 回复为空则移除该消息气泡，否则保留已有内容并标记 `isStreaming: false`
- `InputArea` 在 `isStreaming` 时显示红色"停止"按钮替代"发送"按钮

### 消息时间戳实现

- `ChatMessageItem` 类型新增 `timestamp?: number` 字段
- `sendMessage` 时为 user 和 assistant 消息都附加 `Date.now()`
- `MessageBubble` 新增 `formatTime()` 格式化为 `HH:mm`
- 时间戳默认隐藏，hover 时淡入显示（`.message:hover .message-time { opacity: 1 }`）

### 当前完成状态

| 子项 | 状态 | 说明 |
|------|------|------|
| 停止生成按钮 | ✅ | AbortController + STOP_STREAM action |
| 消息时间戳 | ✅ | hover 显示，HH:mm 格式 |
| Toast CSS | ✅ | 三种类型 + 滑入动画 |
| 空状态提示 CSS | ✅ | 居中灰色小字 |
| AI 头像布局 | ✅ | flex + avatar-ai 圆角方块 |
| 流式指示器 | ✅ | Header 脉冲圆点 |
| 编辑角色删除按钮 | ✅ | 红色危险风格 |
| 导入模态框 radio | ✅ | accent-color + label 样式 |
| 项目规则 | ✅ | .trae/rules/project_rules.md |

---

## 2026-06-09 功能更新：亮色/暗色主题切换

### 变更内容

| 变更项 | 说明 | 状态 |
|--------|------|------|
| useTheme Hook | 管理主题状态，localStorage 持久化，系统偏好检测 | ✅ |
| 亮色主题 CSS 变量 | `[data-theme="light"]` 定义完整亮色变量体系 | ✅ |
| 主题切换按钮 | ChatHeader 右侧太阳/月亮图标按钮 | ✅ |
| 硬编码颜色替换 | header/input bar/modal overlay 背景改用 CSS 变量 | ✅ |
| 亮色语义色适配 | Toast/错误/警告/停止按钮等亮色下使用更深的实色 | ✅ |
| FOUC 防闪烁 | index.html 内联脚本在渲染前设置 data-theme | ✅ |
| theme-color 联动 | 切换主题同步更新 `<meta name="theme-color">` | ✅ |
| 欢迎页文字不可选中 | `.welcome-state` 添加 `user-select: none` | ✅ |
| 输入区外层不可选中 | `#input-area` 添加 `user-select: none`，textarea 内部仍可选中 | ✅ |

### 当前完成状态

| 子项 | 状态 | 说明 |
|------|------|------|
| 暗色主题 | ✅ | 默认主题，保持原有暖调暗色 |
| 亮色主题 | ✅ | 暖白底 + 深色文字 + 同系珊瑚色 |
| 主题持久化 | ✅ | localStorage `companion-theme` |
| 系统偏好检测 | ✅ | `prefers-color-scheme: light` |
| 切换按钮 | ✅ | ChatHeader 右侧，SVG 太阳/月亮图标 |
| 语义色适配 | ✅ | 错误/成功/警告/停止按钮在亮色下使用实色 |
| FOUC 防护 | ✅ | 内联脚本 + meta theme-color |
| 移动端适配 | ✅ | 按钮触摸友好 36px |

---

## 2026-06-09 功能确认：Docker 部署

> Docker 部署功能在 2026-06-06 已完成，此处为确认记录和文档补充。

### 架构概览

```
┌─────────────────────────────────────────────────┐
│              Docker Compose 编排                  │
│                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │ postgres │  │embedding │  │    api        │   │
│  │ pgvector │  │ Python   │  │ NestJS+Web   │   │
│  │ :5432    │  │ :8000    │  │ :3000        │   │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘   │
│       │              │               │            │
│       └──────────────┴───────────────┘            │
│            Docker 内部网络                         │
└─────────────────────────────────────────────────┘
```

### 服务清单

| 服务 | 镜像 | 端口 | 说明 |
|------|------|------|------|
| `postgres` | `pgvector/pgvector:pg16` | 54321→5432 | PostgreSQL + pgvector 扩展 |
| `embedding` | 自建 (`python/Dockerfile`) | 8000→8000 | Python FastAPI embedding 服务 |
| `api` | 自建 (`Dockerfile`) | 3000→3000 | NestJS API + 静态 Web 前端 |

### 文件清单

| 文件 | 说明 |
|------|------|
| `Dockerfile` | 多阶段构建：安装依赖 → 编译 Web → 编译 API → 运行时镜像 |
| `python/Dockerfile` | Python 运行时：uv 安装依赖 → 运行 uvicorn |
| `docker-compose.yml` | 三服务编排 + 健康检查 + 依赖关系 |
| `.env.docker.example` | 环境变量模板 |
| `.dockerignore` | 排除 node_modules/dist/模型等 |
| `python/.dockerignore` | 排除 .venv/模型等 |
| `docs/Docker_Deployment.md` | 部署指南 |

### 关键设计

| 设计点 | 说明 |
|--------|------|
| 多阶段构建 | 4 阶段：api-deps → web-deps → builder → runtime，最终镜像不含编译工具 |
| 模型外挂 | ONNX 模型通过 volume 挂载，不打入镜像（文件 ~400MB） |
| 健康检查 | postgres 用 `pg_isready`，embedding 用 HTTP `/health` |
| 服务发现 | Docker 内部网络，API 通过服务名 `postgres:5432` 和 `http://embedding:8000` 访问 |
| 数据持久化 | `postgres_data` 命名卷，`down` 不删除，`down -v` 才删除 |
| 依赖顺序 | `api` 依赖 `postgres` 和 `embedding` 健康后才启动 |

### 当前完成状态

| 子项 | 状态 | 说明 |
|------|------|------|
| API Dockerfile | ✅ | 多阶段构建，最终镜像仅含运行时 |
| Embedding Dockerfile | ✅ | uv + uvicorn，模型外挂 |
| docker-compose.yml | ✅ | 三服务编排 + 健康检查 |
| 环境变量模板 | ✅ | .env.docker.example |
| .dockerignore | ✅ | 根目录 + python 目录 |
| 部署文档 | ✅ | docs/Docker_Deployment.md |
| Mock Embedding 模式 | ✅ | 无模型时可快速联调 |
| start.bat 一键启动 | ✅ | 双击启动全部开发服务，含环境检查 |

---

## 2026-06-09 功能更新：start.bat 开发启动器

### 变更内容

| 变更项 | 说明 | 状态 |
|--------|------|------|
| start.bat 重写 | 从纯提示改为自动启动所有服务 | ✅ |
| 环境检查 | 启动前检查 Docker/Node.js/uv 是否安装 | ✅ |
| 数据库智能启动 | 先尝试 docker start，失败则 docker compose up | ✅ |
| 每服务独立窗口 | Embedding/API/Web 各自独立 cmd 窗口 | ✅ |

### 当前完成状态

| 子项 | 状态 | 说明 |
|------|------|------|
| PostgreSQL 启动 | ✅ | Docker 容器，优先复用已有容器 |
| Embedding 启动 | ✅ | Mock 模式 + --reload 热更新 |
| API 启动 | ✅ | npm run start:dev 热更新 |
| Web 前端启动 | ✅ | npm run dev Vite HMR |
| 前置检查 | ✅ | Docker / Node.js / uv 缺失时提示安装 |
