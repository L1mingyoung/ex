# AI 伴侣后端 —— 最终技术框架与实现思路

> 目标：搭建一套能长期记忆、模拟人格、具备情绪变化的 AI 伴侣系统。
> 核心原则：**单库存储、模块化架构、最小可用先行。**

---

## 一、技术栈（已确定，不再变动）

| 层级 | 技术 | 用途 |
|------|------|------|
| **主框架** | NestJS 10 + TypeScript | HTTP API、业务编排、模块管理 |
| **数据库** | PostgreSQL 16 + pgvector | 关系数据 + 向量数据，单库存储 |
| **ORM** | TypeORM 0.3.x | 关系字段 CRUD + Migration 管理 |
| **向量字段** | Raw SQL (`repo.query()`) | pgvector 的 `VECTOR(768)` 类型 TypeORM 不原生支持，走原生 SQL |
| **Embedding** | Python FastAPI + ONNX Runtime + Jina v2 base zh | 本地推理，文本 → 768 维向量 |
| **LLM** | DeepSeek API | 对话生成 / 滚动摘要 / 记忆提取 |
| **进程管理** | PM2 | NestJS 进程守护 |
| **运行环境** | Node.js 18+ / Python 3.10+ / Windows（本地验证）→ Linux（生产） |

---

## 二、整体架构

```
用户（Web / 客户端 / 后期 WebSocket）
    │
    ▼
┌─────────────────────────────────────────────────┐
│  NestJS（端口 3000）                              │
│  ├── ChatController → 接收消息                     │
│  ├── ChatService   → 编排完整对话流程               │
│  ├── CharactersService → 角色管理                  │
│  ├── SessionsService   → 会话管理                  │
│  ├── MessagesService   → 消息读写                  │
│  ├── MemoriesService   → 记忆检索 + 写入（Raw SQL） │
│  ├── LlmService        → 调 DeepSeek API           │
│  └── EmbeddingService  → HTTP 调 Python /embed      │
└─────────────────────────────────────────────────┘
    │
    ├── SQL ──────────────────→  PostgreSQL（端口 5432）
    │                             ├── characters（角色配置）
    │                             ├── sessions（会话 + 滚动摘要）
    │                             ├── messages（消息全量）
    │                             └── memory_chunks（记忆碎片 + VECTOR 字段）
    │
    └── HTTP ─────────────────→  Python FastAPI（端口 8000）
                                    └── ONNX Runtime（Jina v2 base zh）
                                            只做一件事：文本 → 768 维向量
```

**关键设计**：向量检索从 Python 服务下沉到 PostgreSQL。Python 只做 Embedding 推理，不碰检索。

---

## 三、数据库设计（PostgreSQL 单库）

```sql
-- 启用扩展（执行一次）
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. 角色表
CREATE TABLE characters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_prompt TEXT NOT NULL,
    model TEXT DEFAULT 'deepseek-chat',
    speech_patterns JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 会话表
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    character_id TEXT REFERENCES characters(id),
    title TEXT,
    summary TEXT,
    message_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 消息表（全量留存）
CREATE TABLE messages (
    id BIGSERIAL PRIMARY KEY,
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    emotion_snapshot JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 记忆碎片表（替代 ChromaDB，含向量字段）
CREATE TABLE memory_chunks (
    id BIGSERIAL PRIMARY KEY,
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    source_msg_id BIGINT REFERENCES messages(id),
    content TEXT NOT NULL,
    embedding VECTOR(768),              -- Jina v2 base zh = 768 维
    memory_type TEXT CHECK (memory_type IN ('fact', 'preference', 'emotion')),
    importance_score FLOAT DEFAULT 0.5,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_accessed TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_memory_embedding ON memory_chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_memory_session ON memory_chunks(session_id, created_at DESC);
CREATE INDEX idx_messages_session ON messages(session_id, created_at DESC);
```

---

## 四、核心数据流（6 个流程）

### 流程 1：用户发消息 → AI 回复（同步，主流程）

```
1. POST /api/chat/:sessionId
2. 保存用户消息 → messages 表
3. 读取：角色配置 + 滚动摘要 + 最近 10 条消息
4. 调 Python /embed → 用户消息向量化
5. PostgreSQL 向量检索：找最相关的 5 条记忆
6. 组装 system prompt（四层叠加）
7. 调 DeepSeek API → 生成回复
8. 保存 AI 回复 → messages 表
9. 返回给前端
10.【异步】触发记忆提取
11.【异步】检查是否需要滚动摘要
```

### 流程 2：记忆提取（异步，不阻塞用户）

```
新消息入库后
    │
    ▼
调 DeepSeek（轻量 prompt）："提取事实/偏好/情绪碎片"
    │
    ▼
逐条向量化（Python /embed）
    │
    ▼
查重：与已有记忆 cosine > 0.95 → 跳过，否则入库
    │
    ▼
INSERT INTO memory_chunks (content, embedding, ...)
```

### 流程 3：滚动摘要（定时触发）

```
消息数 >= 50 且距离上次摘要 >= 1 小时
    │
    ▼
读取最近 50 条消息
    │
    ▼
调 DeepSeek：压缩成一段摘要
    │
    ▼
UPDATE sessions SET summary = ?, message_count = 0
```

### 流程 4：新建角色

```
POST /api/characters
{
  "id": "xiaoya",
  "name": "小雅",
  "base_prompt": "你是小雅，25岁，温柔体贴..."
}
→ INSERT INTO characters
```

### 流程 5：新建会话

```
POST /api/sessions
{ "characterId": "xiaoya" }
→ INSERT INTO sessions
→ 返回 session_id
```

### 流程 6：聊天记录批量导入（后期）

```
导入 txt/csv 聊天记录
    │
    ▼
逐条过 LLM：提取人格特征（口头禅、回应模式、价值观）
    │
    ▼
生成 character.base_prompt
    │
    ▼
逐条提取记忆碎片 → 向量化 → 入库
```

---

## 五、关键 Service 职责划分

| Service | 职责 | 调用谁 |
|---------|------|--------|
| `CharactersService` | 角色 CRUD | TypeORM Repository |
| `SessionsService` | 会话 CRUD + 摘要更新 | TypeORM Repository |
| `MessagesService` | 消息写入 + 最近 N 条读取 | TypeORM Repository |
| `MemoriesService` | **记忆向量检索（Raw SQL）+ 记忆写入（Raw SQL）+ 查重** | `repo.query()` |
| `EmbeddingService` | HTTP 调 Python `/embed` | `axios` → FastAPI |
| `LlmService` | HTTP 调 DeepSeek API | `axios` → DeepSeek |
| `ChatService` | **核心编排**：拼 prompt → 调 LLM → 返回 + 触发异步 | 调用以上所有 Service |

---

## 六、Prompt 四层叠加结构

每次调 DeepSeek 前，`ChatService` 组装成如下结构：

```
[system]
┌─────────────────────────────────────────┐
│ 第一层：固定人格（base_prompt）            │
│ "你是小雅，25岁，温柔体贴，说话喜欢用    │
│  '呢'和'呀'结尾..."                      │
├─────────────────────────────────────────┤
│ 第二层：滚动摘要（summary）               │
│ 【你们之前的对话摘要】                     │
│ "用户最近换了新工作，压力大，小雅在安慰他" │
├─────────────────────────────────────────┤
│ 第三层：动态记忆（memories 检索结果）       │
│ 【关于用户的记忆】                         │
│ - 用户住在北京                            │
│ - 用户喜欢吃辣                            │
│ - 用户上周被领导批评了                    │
├─────────────────────────────────────────┤
│ 第四层：指令约束                           │
│ 请记住以上信息，用符合你性格的方式回复。    │
│ 保持角色一致性，不要跳出人设。              │
└─────────────────────────────────────────┘

[user/assistant 交替消息...]
[user] 用户当前输入
```

---

## 七、TypeORM 与 pgvector 的协作边界

```typescript
// 关系字段：TypeORM 正常管
@Entity('memory_chunks')
export class MemoryChunk {
  @PrimaryGeneratedColumn() id: number;
  @Column() content: string;
  @Column({ name: 'memory_type' }) memoryType: string;
  // ... 其他普通字段

  // ❌ embedding 向量字段不在这里映射
}

// 向量操作：MemoriesService 里手写 Raw SQL
async search(sessionId: string, embedding: number[], limit = 5) {
  const vectorStr = `[${embedding.join(',')}]`;
  return this.memoryRepo.query(`
    SELECT id, content, memory_type, 
           1 - (embedding <=> $1::vector) as similarity
    FROM memory_chunks
    WHERE session_id = $2
    ORDER BY embedding <=> $1::vector
    LIMIT $3
  `, [vectorStr, sessionId, limit]);
}
```

**原则**：能走 TypeORM 的走 TypeORM，向量相关的走 `query()`，不硬怼不支持的类型。

---

## 八、Python FastAPI（最小化，只做 Embedding）

```python
from fastapi import FastAPI
from pydantic import BaseModel
import onnxruntime as ort

app = FastAPI()
sess = ort.InferenceSession("models/jina-embeddings-v2-base-zh.onnx")

class EmbedReq(BaseModel):
    text: str

@app.post("/embed")
def embed(req: EmbedReq):
    inputs = {"input": [req.text]}
    outputs = sess.run(None, inputs)
    return {"embedding": outputs[0][0].tolist()}

@app.post("/batch_embed")
def batch_embed(texts: list[str]):
    inputs = {"input": texts}
    outputs = sess.run(None, inputs)
    return {"embeddings": [v.tolist() for v in outputs[0]]}
```

**注意**：没有 `/search` 接口。检索由 PostgreSQL 做。

---

## 九、第一周实施计划（最小可用）

| 天数 | 任务 | 验收标准 |
|------|------|----------|
| **Day 1** | `nest new companion` 初始化，TypeORM 连 PostgreSQL，装 pgvector 扩展 | `npm run start:dev` 不报错，Migration 能跑通 |
| **Day 2** | 建 Entity + 第一张 Migration，`CharactersModule` / `SessionsModule` CRUD | Postman 能创建角色和会话 |
| **Day 3** | `MessagesModule` + `ChatService` 基础对话（**不接向量，不接记忆**） | 能对角色发消息，收到 DeepSeek 回复 |
| **Day 4** | Python FastAPI 跑通，`EmbeddingService` 接入 NestJS | NestJS 能调通 `/embed`，拿到 768 维数组 |
| **Day 5** | `MemoriesService`（Raw SQL 向量检索 + 写入），接入 `ChatService` | 聊天时能召回历史记忆，AI 回答带上下文 |
| **Day 6** | 异步记忆提取（`setImmediate`），滚动摘要（50 条触发） | 聊完后后台自动拆解记忆；满 50 条自动生成摘要 |
| **Day 7** | 联调 + 查重去重 + 补 `.env` + 写启动文档 | 完整体验一次 20 轮以上长对话，记忆能持续累积 |

---

## 十、环境变量 `.env`

```env
# 数据库
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=yourpassword
DB_NAME=companion

# LLM
DEEPSEEK_API_KEY=sk-xxxxxxxx

# Python 向量服务
PYTHON_EMBED_URL=http://localhost:8000

# NestJS
PORT=3000
```

---

## 十一、本地启动命令（Windows）

```bash
# 终端 1：PostgreSQL（Docker）
docker run -d --name pg \
  -e POSTGRES_PASSWORD=yourpassword \
  -e POSTGRES_DB=companion \
  -p 5432:5432 \
  -v pgdata:/var/lib/postgresql/data \
  ankane/pgvector:latest

# 终端 2：Python Embedding 服务
cd python
pip install -r requirements.txt
uvicorn main:app --port 8000

# 终端 3：NestJS 主服务
cd node
npm install
npx typeorm migration:run -d dist/config/database.config.js
npm run start:dev
```

---

## 十二、后续扩展（明确不做在第一周）

| 扩展项 | 说明 | 优先级 |
|--------|------|--------|
| **SSE 流式响应** | DeepSeek 流式返回，前端逐字显示 | Week 2 |
| **@nestjs/bull 队列** | 记忆提取和摘要进 Redis 队列，可重试可监控 | Week 3-4 |
| **WebSocket 实时聊天** | `@nestjs/websockets`，前端 socket 直连 | Week 3-4 |
| **jiwen 情绪引擎** | 开源情绪状态计算，拼进 prompt | Month 2 |
| **聊天记录批量导入** | 微信/QQ 导出 → 自动提取人格 + 记忆 | Month 2 |
| **三路召回 + RRF** | FTS5 关键词 + 向量语义 + 实体聚合 + RRF 融合 | Month 2-3 |
| **多用户系统** | users 表 + JWT + 数据隔离 | Month 3 |
| **PostgreSQL → 分布式** | 向量数据百万级后考虑 Milvus | 远期 |

---

## 十三、一句话总结

**这套系统的本质**：每次调 DeepSeek 之前，系统先从 PostgreSQL 里用向量检索找到最相关的历史记忆，和角色人格、滚动摘要一起拼成 system prompt，让 AI 的回复带有长期记忆和人格一致性。Python 只负责把文本变成数字向量，剩下的一切都交给 NestJS + PostgreSQL 处理。
