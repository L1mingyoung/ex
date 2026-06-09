# AI 伴侣/角色模拟后端 —— 从零到可用实现逻辑

> 目标：搭一套能"记住你、模拟人、有情绪"的 AI 后端。
> 技术栈：Node.js + Python + SQLite + ChromaDB + DeepSeek API

---

## 一、整体架构（一句话）

**Node.js 负责调度（API + 业务），Python 负责向量（Embedding + 检索），SQLite 存关系数据，ChromaDB 存向量，DeepSeek 负责推理。**

```
用户
 │
 ▼
Cloudflare Tunnel / 直接访问
 │
 ▼
┌─────────────────────────────────────────────────────────────┐
│  Node.js Express（主服务，端口 3000）                         │
│  ├── 接收用户消息                                             │
│  ├── 读取 SQLite（历史消息、角色配置）                         │
│  ├── 调用 Python 服务检索相关记忆                               │
│  ├── 组装 system prompt（人格 + 情绪 + 记忆）                  │
│  ├── 调 DeepSeek API 生成回复                                  │
│  ├── 保存消息到 SQLite                                         │
│  └── 异步触发：摘要生成、记忆提取                                │
└─────────────────────────────────────────────────────────────┘
 │                           │
 │                           ▼
 │                   ┌───────────────┐
 │                   │  SQLite       │
 │                   │  messages     │
 │                   │  summaries    │
 │                   │  characters   │
 │                   └───────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────────────┐
│  Python FastAPI（向量服务，端口 8000）                         │
│  ├── /embed   → 文本转向量（Jina ONNX 本地推理）               │
│  ├── /search  → 向量检索（ChromaDB）                           │
│  └── /batch_embed → 批量向量化                                │
└─────────────────────────────────────────────────────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────────────┐
│  ChromaDB（向量数据库，本地文件）                              │
│  └── collections/memory_chunks                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、技术栈清单

| 层级       | 技术            | 用途              | 安装方式                      |
| ---------- | --------------- | ----------------- | ----------------------------- |
| 运行时     | Node.js 18+     | 主 API 服务       | 官网下载                      |
| 运行时     | Python 3.10+    | 向量服务          | 官网下载                      |
| 主框架     | Express 4.x     | HTTP API          | `npm i express`               |
| 数据库驱动 | better-sqlite3  | SQLite 同步操作   | `npm i better-sqlite3`        |
| 向量服务   | FastAPI         | Python API        | `pip install fastapi uvicorn` |
| 向量数据库 | ChromaDB        | 存储/检索向量     | `pip install chromadb`        |
| 推理引擎   | ONNX Runtime    | 本地 Embedding    | `pip install onnxruntime`     |
| 模型       | Jina v2 base zh | 文本转 768 维向量 | 下载 `.onnx` 文件             |
| LLM        | DeepSeek API    | 对话/摘要/提取    | 官网申请 Key                  |
| 进程管理   | PM2             | Node 进程守护     | `npm i -g pm2`                |

---

## 三、数据库设计（最简版，先能跑）

### 3.1 SQLite（关系数据）

```sql
-- 角色表：每个 AI 角色一条记录
CREATE TABLE characters (
    id TEXT PRIMARY KEY,           -- 如 "xiaoya"
    name TEXT NOT NULL,            -- 显示名称
    base_prompt TEXT NOT NULL,     -- 固定人格 prompt
    model TEXT DEFAULT 'deepseek-chat',  -- 用哪个模型
    created_at INTEGER             -- Unix 时间戳
);

-- 会话表：每次新建聊天一个会话
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,           -- UUID
    character_id TEXT,             -- 关联角色
    title TEXT,                    -- 会话标题（可自动生成）
    summary TEXT,                  -- 滚动摘要（一开始空）
    message_count INTEGER DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER
);

-- 消息表：全量留存，一条消息一行
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at INTEGER
);

-- 记忆碎片表：从消息里提取的事实/偏好（注意：这是"提炼后的记忆"，不是原始消息）
CREATE TABLE memory_fragments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    source_msg_id INTEGER,         -- 从哪条消息提取的
    content TEXT NOT NULL,         -- 记忆内容，如"用户住在北京"
    memory_type TEXT CHECK(memory_type IN ('fact', 'preference', 'emotion')),
    chroma_id TEXT,                -- 关联 ChromaDB 的 ID
    created_at INTEGER
);
```

### 3.2 ChromaDB（向量数据）

不需要 SQL 建表，Python 代码里直接创建 Collection：

```python
import chromadb
client = chromadb.PersistentClient(path="./chroma_data")

collection = client.get_or_create_collection(
    name="memory_chunks",
    metadata={"hnsw:space": "cosine"}  # 用余弦相似度
)
```

**存储结构**：
| 字段 | 说明 |
|------|------|
| `ids` | 唯一标识（如 `mem_001`） |
| `documents` | 记忆文本（如 "用户住在北京"） |
| `embeddings` | 768 维向量 |
| `metadatas` | `{session_id, memory_type, created_at}` |

---

## 四、核心流程（4 个主流程 + 2 个异步流程）

### 4.1 主流程 1：用户发消息 → AI 回复

```
1. 用户 POST /api/chat {session_id, content}
        │
2. Node 校验参数，写入 SQLite messages（user 角色）
        │
3. Node 读取该会话的：
   ├── 最近 10 条原始消息（给 LLM 看上下文）
   ├── 滚动 summary（如果有）
   └── 角色 base_prompt
        │
4. Node 调用 Python /search，传入用户当前消息
   └── Python：Jina ONNX 向量化 → ChromaDB 检索 → 返回 Top-5 记忆
        │
5. Node 组装 system prompt：
   ├── 第一层：base_prompt（固定人格）
   ├── 第二层：summary（中期压缩）
   ├── 第三层：检索到的记忆碎片（动态记忆）
   └── 第四层：最近 10 条消息（即时上下文）
        │
6. Node 调 DeepSeek API
   └── messages: [system, ...history, user]
        │
7. DeepSeek 返回 assistant 回复
        │
8. Node 写入 SQLite messages（assistant 角色）
        │
9. Node 返回 SSE 流（或完整 JSON）给前端
        │
10.【异步】触发记忆提取任务（见 4.3）
```

### 4.2 主流程 2：新建角色

```
POST /api/characters
{
    "id": "xiaoya",
    "name": "小雅",
    "base_prompt": "你是小雅，25岁，温柔体贴，说话喜欢用'呢'和'呀'..."
}
→ 写入 SQLite characters 表
→ 前端可以直接选这个角色开始聊天
```

### 4.3 异步流程 1：记忆提取（每条消息触发）

```
用户消息/AI回复 入库后
        │
        ▼
后台调 DeepSeek API（用便宜的模型，如 deepseek-chat）
Prompt："从以下对话中提取事实、偏好或情绪碎片，每条一行：\n\n用户：我今天搬家到北京了\nAI：..."
        │
        ▼
LLM 返回：
- [事实] 用户住在北京
- [情绪] 用户对搬家感到疲惫
        │
        ▼
写入 SQLite memory_fragments
        │
        ▼
调用 Python /embed 向量化
        │
        ▼
存入 ChromaDB
```

**关键**：这个流程不阻塞用户，用 Node 的 `setImmediate` 或 `bull` 队列丢后台做。

### 4.4 异步流程 2：滚动摘要（每 50 条触发）

```
消息表 count 达 50 条
        │
        ▼
读取这 50 条消息
        │
        ▼
调 DeepSeek："请总结以下对话的核心内容：..."
        │
        ▼
生成摘要（如 "用户和小雅聊了新工作，用户压力大，小雅安慰了他"）
        │
        ▼
写入 SQLite sessions.summary
        │
        ▼
清空计数或标记已摘要的消息
```

**触发条件**：消息数 >= 50 且距离上次摘要 >= 1 小时。

---

## 五、API 接口清单（最简版）

```
角色管理
  POST   /api/characters          创建角色
  GET    /api/characters          列表
  GET    /api/characters/:id      详情

会话管理
  POST   /api/sessions            新建会话（选角色）
  GET    /api/sessions            列表
  GET    /api/sessions/:id        详情（含历史消息）

聊天
  POST   /api/chat                发消息（SSE 流式返回）

向量服务（Python FastAPI，内部调用，不暴露外网）
  POST   /embed                   单条文本向量化
  POST   /batch_embed             批量向量化
  POST   /search                  向量检索
```

---

## 六、目录结构（建议）

```
companion-backend/
├── node/                          # Node.js 主服务
│   ├── package.json
│   ├── .env                       # API Key、数据库路径
│   ├── app.js                     # Express 入口
│   ├── routes/
│   │   ├── chat.js                # /api/chat
│   │   ├── characters.js          # /api/characters
│   │   └── sessions.js            # /api/sessions
│   ├── services/
│   │   ├── llm.js                 # 调 DeepSeek 封装
│   │   ├── vectorService.js       # HTTP 调用 Python 向量服务
│   │   ├── memoryExtractor.js     # 异步记忆提取
│   │   └── summarizer.js          # 滚动摘要
│   ├── db/
│   │   └── sqlite.js              # better-sqlite3 连接 + 初始化
│   └── utils/
│       └── promptBuilder.js       # 组装 system prompt
│
├── python/                        # Python 向量服务
│   ├── requirements.txt
│   ├── main.py                    # FastAPI 入口
│   ├── embedder.py                # Jina ONNX 推理封装
│   └── chroma_client.py           # ChromaDB 操作封装
│
├── data/                          # 数据文件（不提交 git）
│   ├── companion.db               # SQLite 文件
│   └── chroma_data/               # ChromaDB 本地文件
│
├── models/                        # 模型文件（不提交 git）
│   └── jina-embeddings-v2-base-zh.onnx
│
└── docker-compose.yml             # 可选：后期上 Docker
```

---

## 七、关键代码片段（核心逻辑）

### 7.1 组装 Prompt（Node）

```javascript
function buildPrompt(character, summary, memories, recentMessages) {
  const parts = [
    // 第一层：固定人格
    character.base_prompt,

    // 第二层：滚动摘要
    summary ? `【你们之前的对话摘要】\n${summary}` : '',

    // 第三层：动态记忆
    memories.length
      ? `【关于用户的记忆】\n${memories.map((m) => `- ${m}`).join('\n')}`
      : '',

    // 限制
    `请记住以上信息，用符合你性格的方式回复。`,
  ];

  return {
    system: parts.filter(Boolean).join('\n\n'),
    messages: recentMessages, // 最近 10 条
  };
}
```

### 7.2 向量检索（Python）

```python
from fastapi import FastAPI
from pydantic import BaseModel
import onnxruntime as ort
import numpy as np
import chromadb

app = FastAPI()

# 加载 Jina ONNX
sess = ort.InferenceSession("models/jina-embeddings-v2-base-zh.onnx")
client = chromadb.PersistentClient(path="./data/chroma_data")
collection = client.get_collection("memory_chunks")

def embed(text: str):
    # 具体输入输出要看模型文档，这里示意
    inputs = {"input": [text]}
    outputs = sess.run(None, inputs)
    return outputs[0][0].tolist()  # 768 维数组

@app.post("/search")
def search(query: str, top_k: int = 5):
    vec = embed(query)
    results = collection.query(
        query_embeddings=[vec],
        n_results=top_k
    )
    return {"memories": results["documents"][0]}
```

### 7.3 异步记忆提取（Node）

```javascript
// chat.js 里，回复用户后立刻返回，不等待提取
async function handleChat(req, res) {
    // ... 生成回复 ...
    res.json({ reply: assistantContent });

    // 异步提取（不阻塞）
    setImmediate(() => {
        extractMemory(sessionId, userContent, assistantContent);
    });
}

async function extractMemory(sessionId, userMsg, assistantMsg) {
    const prompt = `从以下对话中提取事实/偏好/情绪碎片：
用户：${userMsg}
AI：${assistantMsg}
输出格式：每行一个，[类型] 内容`;

    const result = await callLLM(prompt);  // 调 DeepSeek
    const memories = parseMemories(result);

    for (const mem of memories) {
        // 写入 SQLite
        const fragmentId = db.prepare(
            'INSERT INTO memory_fragments ...'
        ).run(...).lastInsertRowid;

        // 向量化 + 存入 ChromaDB
        await vectorService.addMemory(fragmentId, mem.content, sessionId);
    }
}
```

---

## 八、部署方案（三选一）

### 方案 A：本地 Windows（零成本验证）

```bash
# 终端1：Node
cd node && npm install && npm start

# 终端2：Python
cd python && pip install -r requirements.txt && uvicorn main:app --port 8000

# 访问：http://localhost:3000
# Python 向量服务只给 Node 用，不暴露外网
```

### 方案 B：云服务器 Linux（长期运行）

```bash
# 买一台 2核4G Ubuntu
# PM2 跑 Node，systemd 或 PM2 跑 Python
# 有公网 IP 的话不需要 Cloudflare Tunnel
```

### 方案 C：Docker Compose（推荐，后期）

```yaml
# docker-compose.yml
version: '3'
services:
  node:
    build: ./node
    ports: ['3000:3000']
    environment:
      - DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}
    volumes:
      - ./data:/app/data

  python:
    build: ./python
    ports: ['8000:8000']
    volumes:
      - ./data:/app/data
      - ./models:/app/models
```

---

## 九、实施优先级（第一周做什么）

| 天数  | 任务                             | 产出                        |
| ----- | -------------------------------- | --------------------------- |
| Day 1 | 初始化项目，装依赖，SQLite 建表  | `node` 和 `python` 目录能跑 |
| Day 2 | 实现角色 CRUD + 会话 CRUD        | Postman 能创建角色和会话    |
| Day 3 | 打通 DeepSeek 对话（最简单版本） | 能对角色发消息，收到回复    |
| Day 4 | 接入 Python 向量服务 + ChromaDB  | 能存入/检索向量             |
| Day 5 | 异步记忆提取（最简单版本）       | 聊天后后台自动提取记忆      |
| Day 6 | 滚动摘要 + Prompt 组装           | AI 能记住 50 条之前的摘要   |
| Day 7 | 联调 + 修 bug                    | 完整体验一次长对话          |

---

## 十、常见坑（提前避）

| 坑                        | 原因                      | 解决方案                                                   |
| ------------------------- | ------------------------- | ---------------------------------------------------------- |
| ChromaDB Windows 路径报错 | 用户目录带中文/空格       | 显式指定 `path="D:/companion/chroma_data"`                 |
| better-sqlite3 安装失败   | 缺少 Python/C++ 编译环境  | `npm install --build-from-source` 或装 windows-build-tools |
| DeepSeek API 超时         | 生成长文本慢              | 开 SSE 流式，或调短 `max_tokens`                           |
| 记忆重复提取              | "用户住在北京"被提取 5 次 | 入库前查重：新记忆和已有记忆 cosine > 0.95 则跳过          |
| 向量检索返回不相关        | 查询太短（如"嗯"）        | 短消息不做向量检索，或拼接上下文再检索                     |
| SQLite 锁库               | 异步写入并发              | 用 WAL 模式：`PRAGMA journal_mode=WAL;`                    |

---

## 十一、后续扩展（不要一开始做）

- [ ] 聊天记录批量导入（微信/QQ 导出 → 提取人格）
- [ ] jiwen 情绪引擎接入
- [ ] 三路召回（FTS5 + 向量 + 实体聚合）
- [ ] RRF 融合排序
- [x] QQ Bot 适配器（v2 已完成，详见 `docs/QQ_Bot_Integration.md`）
- [ ] Telegram Bot
- [ ] 多用户注册/登录
- [ ] 主动消息推送（定时触发 / 事件驱动）
- [ ] WebSocket 实时聊天界面
- [ ] 移动端 App

---

## 十二、QQ Bot 接入（已完成 v2）

### 12.1 架构

```
QQ 用户 ──→ QQ WebSocket 网关 ──→ QQ Bot 适配器 ──→ NestJS API ──→ DeepSeek
                                    (独立进程)
```

### 12.2 已实现功能

| 功能              | 说明                                                  |
| ----------------- | ----------------------------------------------------- |
| Access Token 鉴权 | 旧 Token 方式已废弃，改用 AppSecret 获取 Access Token |
| Op 6 Resume       | 断线恢复，不丢消息，状态持久化到 `.qq-bot-state.json` |
| 私聊消息          | `C2C_MESSAGE_CREATE` 事件                             |
| 群聊消息          | `GROUP_AT_MESSAGE_CREATE` 事件                        |
| 消息去重          | 幂等处理，防止平台重复推送                            |
| 频率控制          | 被动回复 5 分钟内最多 2 条                            |
| 沙箱/正式切换     | `.env` 中 `QQ_BOT_SANDBOX=1` 切换沙箱模式             |

### 12.3 启动方式

```bash
# 单独启动
npm run qqbot
# 或
node adapters/qq-bot/index.js

# 一键启动（start.bat 自动检测 .env 中的 QQ_BOT_APP_ID）
start.bat
```

### 12.4 待完善

- [ ] 富文本消息（图片、表情、Markdown）
- [ ] 消息队列化（进一步控制频率）
- [ ] 主动消息推送（结合定时任务）
- [ ] 正式环境审核通过后切换网关

### 12.5 相关文档

- 详细接入指南：`docs/QQ_Bot_Integration.md`
- 适配器代码：`adapters/qq-bot/index.js`

---

## 十三、Docker 部署方案

### 13.1 为什么需要 Docker

| 问题       | 传统部署                      | Docker 部署                     |
| ---------- | ----------------------------- | ------------------------------- |
| 环境不一致 | "我电脑能跑你电脑不行"        | 一次构建，到处运行              |
| 依赖冲突   | Node/Python/PG 版本要单独管理 | 全部封装在镜像里                |
| 部署步骤   | 手动装十几个依赖，容易出错    | `docker compose up -d` 一键启动 |
| 迁移服务器 | 重新配环境，可能花一天        | 拉镜像，启动，几分钟搞定        |

### 13.2 项目 Docker 架构

```
docker-compose.yml（一键编排三个服务）
│
├── postgres（pgvector/pgvector:pg16）
│   └── PostgreSQL + pgvector 向量扩展，端口 55432
│
├── embedding（自定义构建 ./python）
│   └── Python FastAPI + ONNX Runtime，端口 8000
│
├── api（自定义构建 .）
│   └── NestJS API + React 前端，端口 3000
│
└── qqbot（复用 api 镜像，profiles 按需启动）
    └── QQ Bot WebSocket 适配器
```

### 13.3 两种部署方式

**方式一：服务器构建（传统）**

```bash
# 服务器上
git clone → 创建 .env → docker compose up -d --build
```

- 优点：简单直接
- 缺点：服务器网络差时构建很慢（PyPI/npm 下载慢）

**方式二：本地打包上传（推荐）**

```bash
# 本地 Windows：双击 deploy.bat
# 自动完成：构建镜像 → docker save 导出 → scp 上传

# 服务器上：
docker load -i companion-images.tar
docker compose -f docker-compose.prod.yml up -d
```

- 优点：利用本地网络，构建快
- 缺点：镜像文件较大（约 500MB-1GB）

### 13.4 关键文件

| 文件                      | 说明                                |
| ------------------------- | ----------------------------------- |
| `docker-compose.yml`      | 开发环境编排（含 `build:` 指令）    |
| `docker-compose.prod.yml` | 生产环境编排（用预构建镜像）        |
| `Dockerfile`              | NestJS + React 多阶段构建           |
| `python/Dockerfile`       | Python 向量服务构建（含清华镜像源） |
| `deploy.bat`              | 本地一键打包上传脚本                |

### 13.5 待完善

- [ ] CI/CD 自动化（推送代码自动构建+部署）
- [ ] Docker 镜像压缩（当前 api 镜像较大）
- [ ] 容器资源限制（memory/cpu limits）
- [ ] 日志集中管理（ELK/Loki）

---

## 十四、总结：这套系统的本质

```
普通聊天机器人：
  用户 → LLM → 回复（每次都像第一次见）

这套系统：
  用户 → 【查历史 + 查记忆 + 算情绪 + 拼 prompt】→ LLM → 回复
                                    ↑
                              这些才是核心
```

**LLM 只是大脑，你搭的是给大脑供血的血管和神经系统。**
