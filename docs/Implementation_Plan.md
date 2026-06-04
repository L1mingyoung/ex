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
| Embedding | Python FastAPI + ONNX Runtime（Mock 模式） | ✅ Mock / ⏳ 真实模型 |
| LLM | DeepSeek API | ✅ |
| 前端 | 原生 HTML/CSS/JS（SSE 流式） | ✅ |
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
| 后续 | 下载 ONNX 真实模型 / 小程序 / Bot 接入 | ⏳ |

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
├── client/                       # Web 前端（纯展示层）
│   ├── index.html                # 聊天页面
│   ├── css/style.css             # 响应式设计
│   └── js/
│       ├── api.js                # 🔑 API 调用层（可复用）
│       └── chat.js               # UI 交互逻辑
│
├── adapters/                     # 平台适配器
│   ├── miniprogram/api.js        # 微信小程序 (wx.request)
│   ├── miniprogram/api-uni.js    # uni-app 跨端 (uni.request)
│   └── qq-bot/adapter.js         # QQ Bot 适配
│
├── python/                       # Python Embedding 服务
│   ├── pyproject.toml
│   ├── main.py                   # FastAPI（/embed, /batch_embed, /health）
│   ├── embedder.py               # ONNX Runtime 封装
│   └── models/                   # ONNX 模型（待下载）
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
         ┌─ import API from 'client/js/api.js'              → Web / React Native
相同函数 ─┼─ import API from 'adapters/miniprogram/api.js'    → 微信小程序
签名     └─ import API from 'adapters/miniprogram/api-uni.js' → uni-app 跨端

NestJS API 是唯一数据源，所有客户端只做展示。
```

---

## 如何启动

```bash
# 终端 1：数据库
docker start companion-pg

# 终端 2：Python Embedding
cd python
MOCK_EMBEDDING=1 uv run uvicorn main:app --port 8000

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
| 高 | 下载 ONNX 真实模型 | 替换 Mock，使用真实语义向量 |
| 高 | 小程序 / 移动端 App | 基于 adapters/ 开发 |
| 中 | QQ Bot / Telegram Bot | WebSocket/Webhook 适配 |
| 中 | @nestjs/bull 队列 | 异步任务进 Redis 队列 |
| 低 | jiwen 情绪引擎 | 情绪状态拼进 prompt |
| 低 | 聊天记录批量导入 | 微信/QQ 导出 → 人格提取 |
| 远期 | 多用户系统 | users 表 + JWT |
