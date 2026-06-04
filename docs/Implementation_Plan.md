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

---

## 当前进度

| Day | 内容 | 状态 |
|-----|------|------|
| Day 1 | 项目初始化 + 数据库连接 | ✅ |
| Day 2 | Entity + Characters/Sessions CRUD | ✅ |
| Day 3 | Messages + LlmService + ChatService 基础对话 | ✅ |
| Day 4 | Python FastAPI + EmbeddingService (Mock) | ✅ |
| Day 5 | MemoriesService（向量检索 + 写入 + 查重） | ✅ |
| Day 6 | 异步记忆提取 + 滚动摘要 | ✅ |
| Day 7 | 下载 ONNX 模型 / 前端界面 / 联调 | ⏳ 待实施 |

---

## 目录结构

```
d:\Code\AI\
├── AI_Companion_最终方案.md      # 规格文档
├── Implementation_Plan.md        # 本文件（计划）
├── Learning_Notes.md             # 学习笔记
│
└── companion/
    ├── src/
    │   ├── main.ts
    │   ├── app.module.ts
    │   ├── config/
    │   │   └── database.config.ts
    │   ├── characters/
    │   │   ├── characters.module.ts
    │   │   ├── characters.controller.ts
    │   │   ├── characters.service.ts
    │   │   └── entities/character.entity.ts
    │   ├── sessions/
    │   │   ├── sessions.module.ts
    │   │   ├── sessions.controller.ts
    │   │   ├── sessions.service.ts
    │   │   └── entities/session.entity.ts
    │   ├── messages/
    │   │   ├── messages.module.ts
    │   │   ├── messages.service.ts
    │   │   └── entities/message.entity.ts
    │   ├── memories/
    │   │   ├── memories.module.ts
    │   │   ├── memories.service.ts
    │   │   └── entities/memory.entity.ts    # 仅参考，实际不走 TypeORM
    │   ├── llm/
    │   │   ├── llm.module.ts
    │   │   └── llm.service.ts
    │   ├── embedding/
    │   │   ├── embedding.module.ts
    │   │   └── embedding.service.ts
    │   └── chat/
    │       ├── chat.module.ts
    │       ├── chat.controller.ts
    │       └── chat.service.ts
    │
    ├── python/
    │   ├── pyproject.toml          # uv 依赖声明
    │   ├── main.py                 # FastAPI 入口
    │   ├── embedder.py             # ONNX Runtime 封装
    │   ├── models/                 # ONNX 模型（待下载）
    │   └── .venv/                  # uv 虚拟环境
    │
    ├── .env
    ├── .env.example
    ├── package.json
    └── tsconfig.json
```

---

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/characters` | 创建角色 |
| GET | `/api/characters` | 角色列表 |
| GET | `/api/characters/:id` | 角色详情 |
| DELETE | `/api/characters/:id` | 删除角色 |
| POST | `/api/sessions` | 创建会话 |
| GET | `/api/sessions` | 会话列表 |
| GET | `/api/sessions/:id` | 会话详情 |
| DELETE | `/api/sessions/:id` | 删除会话 |
| POST | `/api/chat/:sessionId` | 发送消息（含记忆检索 + 异步提取） |

### Python 服务（内部调用，不对外暴露）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/embed` | 单条文本 → 768 维向量 |
| POST | `/batch_embed` | 批量文本 → 多个 768 维向量 |
| GET | `/health` | 健康检查 |

---

## 数据库表

| 表名 | 管理方式 | 行数 |
|------|---------|------|
| characters | TypeORM Entity (synchronize) | ~3 |
| sessions | TypeORM Entity (synchronize) | ~7 |
| messages | TypeORM Entity (synchronize) | ~15 |
| memory_chunks | 手动 SQL（VECTOR 列 TypeORM 不支持） | ~5 |

### 关键设计：memory_chunks 不用 TypeORM

因为 `embedding VECTOR(768)` 列 TypeORM 无法识别，`synchronize: true` 会删除此列。所以 `memory_chunks` 表完全手动管理，MemoriesService 直接用 `DataSource.query()` 原生 SQL。

```sql
-- 手动创建（已完成）
CREATE TABLE memory_chunks (
    id BIGSERIAL PRIMARY KEY,
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    source_msg_id BIGINT REFERENCES messages(id),
    content TEXT NOT NULL,
    embedding VECTOR(768),         -- ← TypeORM 不支持
    memory_type TEXT CHECK (...),
    importance_score FLOAT DEFAULT 0.5,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_accessed TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_memory_embedding ON memory_chunks
    USING hnsw (embedding vector_cosine_ops);
```

---

## 核心数据流（Day 6 完整版）

```
用户发消息
    │
    ├── [同步] 保存用户消息 → messages 表
    ├── [同步] 读取角色 + session + 最近 10 条
    ├── [同步] 向量检索 Top-5 记忆 → Prompt 第三层
    ├── [同步] 组装四层 System Prompt
    ├── [同步] 调 DeepSeek → 生成回复
    ├── [同步] 保存 AI 回复 → messages 表
    ├── [同步] 更新消息计数
    └── [同步] 返回 reply 给用户
            │
            ├── [异步] 记忆提取：LLM 提取事实/偏好/情绪 → 向量化 → 查重 → 入库
            └── [异步] 滚动摘要：50 条 + 1 小时 → 压缩历史 → 更新 session.summary
```

---

## 如何启动

```bash
# 终端 1：数据库（如果没有启动）
docker start companion-pg

# 终端 2：Python Embedding 服务
cd python
MOCK_EMBEDDING=1 uv run uvicorn main:app --port 8000

# 终端 3：NestJS 主服务
cd companion
npm run start:dev
```

---

## 后续工作

| 优先级 | 任务 | 说明 |
|--------|------|------|
| 高 | 下载 Jina v2 base zh ONNX 模型 | 替换 Mock 模式，使用真实向量 |
| 高 | 前端聊天界面 | Vue/React 前端，接入 SSE 流式 |
| 中 | SSE 流式响应 | DeepSeek 流式返回，前端逐字显示 |
| 中 | @nestjs/bull 队列 | 记忆提取进 Redis 队列，可重试可监控 |
| 中 | 多角色切换 | 前端支持选择不同角色对话 |
| 低 | jiwen 情绪引擎 | 情绪状态计算，拼进 prompt |
| 低 | 聊天记录批量导入 | 微信/QQ 导出 → 提取人格 + 记忆 |
| 远期 | 多用户系统 | users 表 + JWT + 数据隔离 |
