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
