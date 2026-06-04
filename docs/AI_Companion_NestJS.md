# AI 伴侣后端 —— NestJS + PostgreSQL(pgvector) 完整方案

> Express 升级为 NestJS，SQLite + ChromaDB 合并为 PostgreSQL 单库。
> 技术栈：NestJS + TypeScript + TypeORM + PostgreSQL(pgvector) + Python FastAPI(Embedding) + DeepSeek API

---

## 一、架构变化

```
Express（路由回调）          NestJS（模块化 + 依赖注入）
    │                              │
    ├── 手动拼 SQL                  ├── TypeORM Repository
    ├── 跨文件传 db 实例             ├── @Injectable() Service
    ├── 异步任务 setImmediate       ├── 后期可接 @nestjs/bull
    └── 无标准结构                  ├── Module 边界清晰
```

**核心好处**：
- 角色/会话/消息/记忆 按 Module 拆分，后续加功能不互相污染
- TypeORM 自动 Migration，数据库版本可控
- `pgvector` 向量字段走 Raw SQL（100% 可用），关系字段走 Repository（类型安全）
- 天然支持 WebSocket（`@nestjs/websockets`），后期做实时聊天不用重构

---

## 二、目录结构（NestJS 标准）

```
companion-backend/
├── src/
│   ├── main.ts                          # 应用入口
│   ├── app.module.ts                    # 根模块
│   ├── config/
│   │   └── database.config.ts           # TypeORM 配置
│   │
│   ├── characters/                      # 角色模块
│   │   ├── characters.module.ts
│   │   ├── characters.controller.ts
│   │   ├── characters.service.ts
│   │   └── entities/character.entity.ts
│   │
│   ├── sessions/                        # 会话模块
│   │   ├── sessions.module.ts
│   │   ├── sessions.controller.ts
│   │   ├── sessions.service.ts
│   │   └── entities/session.entity.ts
│   │
│   ├── messages/                        # 消息模块
│   │   ├── messages.module.ts
│   │   ├── messages.service.ts
│   │   └── entities/message.entity.ts
│   │
│   ├── memories/                        # 记忆模块（含向量检索）
│   │   ├── memories.module.ts
│   │   ├── memories.service.ts
│   │   └── entities/memory.entity.ts
│   │
│   ├── llm/                             # LLM 调用封装
│   │   ├── llm.module.ts
│   │   └── llm.service.ts
│   │
│   ├── embedding/                       # Python 向量服务客户端
│   │   ├── embedding.module.ts
│   │   └── embedding.service.ts
│   │
│   └── chat/                            # 聊天编排（核心业务流程）
│       ├── chat.module.ts
│       ├── chat.controller.ts
│       └── chat.service.ts
│
├── python/                              # Python 只负责 ONNX Embedding
│   ├── main.py
│   ├── requirements.txt
│   └── embedder.py
│
├── migrations/                          # TypeORM 自动生成的迁移文件
├── docker-compose.yml
├── .env
└── package.json
```

---

## 三、核心依赖

```json
{
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@nestjs/typeorm": "^10.0.0",
    "@nestjs/config": "^3.0.0",
    "@nestjs/axios": "^3.0.0",
    "typeorm": "^0.3.20",
    "pg": "^8.11.0",
    "axios": "^1.6.0",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.0",
    "class-validator": "^0.14.0",
    "class-transformer": "^0.5.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.3.0",
    "ts-node": "^10.9.0"
  }
}
```

---

## 四、数据库配置

### 4.1 TypeORM 配置

```typescript
// src/config/database.config.ts
import { DataSource } from 'typeorm';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'companion',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  synchronize: false,      // 开发可开，生产必须 false 走 migration
  migrations: [__dirname + '/../../migrations/*{.ts,.js}'],
  migrationsRun: true,     // 启动时自动跑 migration
});
```

### 4.2 关键：pgvector 扩展初始化

首次连接数据库时执行一次：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

可在 `AppDataSource` 初始化后通过 `query()` 执行，或写进 migration。

---

## 五、Entity 定义

**设计原则**：`embedding` 向量字段 **不映射到 TypeORM Entity**（原生不支持 `vector` 类型），关系字段正常用 Repository CRUD，向量操作走 `Repository.query()` 原生 SQL。

```typescript
// src/characters/entities/character.entity.ts
import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('characters')
export class Character {
  @PrimaryColumn({ type: 'text' })
  id: string;                       // 如 "xiaoya"

  @Column()
  name: string;

  @Column({ type: 'text' })
  basePrompt: string;

  @Column({ default: 'deepseek-chat' })
  model: string;

  @Column({ type: 'jsonb', default: {} })
  speechPatterns: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

```typescript
// src/sessions/entities/session.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'character_id' })
  characterId: string;

  @Column({ nullable: true })
  title: string;

  @Column({ type: 'text', nullable: true })
  summary: string;

  @Column({ name: 'message_count', default: 0 })
  messageCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

```typescript
// src/messages/entities/message.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'session_id' })
  sessionId: string;

  @Column({ type: 'enum', enum: ['user', 'assistant'] })
  role: 'user' | 'assistant';

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'jsonb', nullable: true })
  emotionSnapshot: Record<string, number>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

```typescript
// src/memories/entities/memory.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('memory_chunks')
export class MemoryChunk {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'session_id' })
  sessionId: string;

  @Column({ name: 'source_msg_id', nullable: true })
  sourceMsgId: number;

  @Column({ type: 'text' })
  content: string;

  // ⚠️ 注意：embedding 向量字段不在这里映射！
  // TypeORM 原生不支持 vector 类型，插入/检索走 .query() 原生 SQL

  @Column({ name: 'memory_type', type: 'enum', enum: ['fact', 'preference', 'emotion'] })
  memoryType: 'fact' | 'preference' | 'emotion';

  @Column({ name: 'importance_score', type: 'float', default: 0.5 })
  importanceScore: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'last_accessed', type: 'timestamptz', default: () => 'NOW()' })
  lastAccessed: Date;
}
```

---

## 六、核心 Service 代码

### 6.1 EmbeddingService（调 Python FastAPI）

```typescript
// src/embedding/embedding.service.ts
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class EmbeddingService {
  private readonly pythonUrl: string;

  constructor(private readonly httpService: HttpService) {
    this.pythonUrl = process.env.PYTHON_EMBED_URL || 'http://localhost:8000';
  }

  async embed(text: string): Promise<number[]> {
    const { data } = await firstValueFrom(
      this.httpService.post(`${this.pythonUrl}/embed`, { text })
    );
    return data.embedding;
  }

  async batchEmbed(texts: string[]): Promise<number[][]> {
    const { data } = await firstValueFrom(
      this.httpService.post(`${this.pythonUrl}/batch_embed`, texts)
    );
    return data.embeddings;
  }
}
```

### 6.2 MemoriesService（向量检索核心）

```typescript
// src/memories/memories.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MemoryChunk } from './entities/memory.entity';
import { EmbeddingService } from '../embedding/embedding.service';

@Injectable()
export class MemoriesService {
  constructor(
    @InjectRepository(MemoryChunk)
    private memoryRepo: Repository<MemoryChunk>,
    private embeddingService: EmbeddingService,
  ) {}

  /**
   * 向量相似度检索
   */
  async search(sessionId: string, queryEmbedding: number[], limit = 5) {
    const vectorStr = `[${queryEmbedding.join(',')}]`;

    const sql = `
      SELECT 
        id, content, memory_type, 
        1 - (embedding <=> $1::vector) as similarity
      FROM memory_chunks
      WHERE session_id = $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3
    `;

    return this.memoryRepo.query(sql, [vectorStr, sessionId, limit]);
  }

  /**
   * 写入记忆（含向量）
   */
  async addMemory(
    sessionId: string,
    content: string,
    embedding: number[],
    sourceMsgId?: number,
    memoryType: 'fact' | 'preference' | 'emotion' = 'fact',
  ) {
    const vectorStr = `[${embedding.join(',')}]`;

    const sql = `
      INSERT INTO memory_chunks 
        (session_id, source_msg_id, content, embedding, memory_type)
      VALUES ($1, $2, $3, $4::vector, $5)
      RETURNING id, content, memory_type, created_at
    `;

    const result = await this.memoryRepo.query(sql, [
      sessionId,
      sourceMsgId || null,
      content,
      vectorStr,
      memoryType,
    ]);

    return result[0];
  }

  /**
   * 查重：新记忆和已有记忆的相似度 > 0.95 则跳过
   */
  async checkDuplicate(sessionId: string, embedding: number[], threshold = 0.95) {
    const vectorStr = `[${embedding.join(',')}]`;

    const sql = `
      SELECT 1 FROM memory_chunks
      WHERE session_id = $1
        AND 1 - (embedding <=> $2::vector) > $3
      LIMIT 1
    `;

    const result = await this.memoryRepo.query(sql, [sessionId, vectorStr, threshold]);
    return result.length > 0;
  }
}
```

### 6.3 LlmService（调 DeepSeek）

```typescript
// src/llm/llm.service.ts
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

@Injectable()
export class LlmService {
  private readonly apiKey: string;
  private readonly apiUrl = 'https://api.deepseek.com/chat/completions';

  constructor(private readonly httpService: HttpService) {
    this.apiKey = process.env.DEEPSEEK_API_KEY;
  }

  async chat(messages: ChatMessage[], stream = false): Promise<string> {
    const { data } = await firstValueFrom(
      this.httpService.post(
        this.apiUrl,
        {
          model: 'deepseek-chat',
          messages,
          stream,
          max_tokens: 2000,
          temperature: 0.8,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        },
      ),
    );

    return data.choices[0].message.content;
  }
}
```

### 6.4 ChatService（核心编排）

```typescript
// src/chat/chat.service.ts
import { Injectable } from '@nestjs/common';
import { SessionsService } from '../sessions/sessions.service';
import { MessagesService } from '../messages/messages.service';
import { MemoriesService } from '../memories/memories.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { LlmService } from '../llm/llm.service';

@Injectable()
export class ChatService {
  constructor(
    private sessionsService: SessionsService,
    private messagesService: MessagesService,
    private memoriesService: MemoriesService,
    private embeddingService: EmbeddingService,
    private llmService: LlmService,
  ) {}

  async handleMessage(sessionId: string, userContent: string) {
    // 1. 保存用户消息
    const userMsg = await this.messagesService.create(sessionId, 'user', userContent);

    // 2. 读取会话上下文
    const session = await this.sessionsService.findOne(sessionId);
    const recentMessages = await this.messagesService.findRecent(sessionId, 10);

    // 3. 向量检索相关记忆
    const queryEmbedding = await this.embeddingService.embed(userContent);
    const memories = await this.memoriesService.search(sessionId, queryEmbedding, 5);

    // 4. 组装 system prompt
    const systemPrompt = this.buildSystemPrompt(
      session.character,
      session.summary,
      memories,
    );

    // 5. 构造 messages 数组
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...recentMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: userContent },
    ];

    // 6. 调 LLM
    const assistantContent = await this.llmService.chat(messages);

    // 7. 保存 AI 回复
    await this.messagesService.create(sessionId, 'assistant', assistantContent);

    // 8. 更新消息计数
    await this.sessionsService.incrementMessageCount(sessionId);

    // 9. 【异步】触发记忆提取（不阻塞响应）
    setImmediate(() => this.extractMemory(sessionId, userContent, assistantContent, userMsg.id));

    // 10. 【异步】检查是否需要生成摘要
    setImmediate(() => this.checkAndSummarize(sessionId));

    return { reply: assistantContent };
  }

  private buildSystemPrompt(
    character: { basePrompt: string; name: string },
    summary: string | null,
    memories: any[],
  ): string {
    const parts = [
      character.basePrompt,
      summary ? `【你们之前的对话摘要】\n${summary}` : '',
      memories.length
        ? `【关于用户的记忆】\n${memories.map((m) => `- ${m.content}`).join('\n')}`
        : '',
      `请记住以上信息，用符合你性格的方式回复。`,
    ];
    return parts.filter(Boolean).join('\n\n');
  }

  private async extractMemory(
    sessionId: string,
    userMsg: string,
    assistantMsg: string,
    sourceMsgId: number,
  ) {
    try {
      // 调 LLM 提取事实/偏好/情绪
      const prompt = `从以下对话中提取事实、偏好或情绪碎片，每行一条，格式：[类型] 内容\n\n用户：${userMsg}\nAI：${assistantMsg}`;
      const result = await this.llmService.chat([
        { role: 'user', content: prompt },
      ]);

      // 解析结果，逐条入库
      const lines = result.split('\n').filter((l) => l.trim());
      for (const line of lines) {
        const match = line.match(/^\[(事实|偏好|情绪)\]\s*(.+)$/);
        if (!match) continue;

        const [, type, content] = match;
        const embedding = await this.embeddingService.embed(content);

        // 查重
        const isDup = await this.memoriesService.checkDuplicate(sessionId, embedding, 0.95);
        if (isDup) continue;

        const typeMap: Record<string, 'fact' | 'preference' | 'emotion'> = {
          事实: 'fact',
          偏好: 'preference',
          情绪: 'emotion',
        };

        await this.memoriesService.addMemory(
          sessionId,
          content,
          embedding,
          sourceMsgId,
          typeMap[type],
        );
      }
    } catch (err) {
      console.error('[Memory Extract Error]', err.message);
    }
  }

  private async checkAndSummarize(sessionId: string) {
    // 简单实现：每满 50 条触发摘要
    const count = await this.messagesService.countBySession(sessionId);
    if (count % 50 !== 0) return;

    try {
      const messages = await this.messagesService.findRecent(sessionId, 50);
      const text = messages.map((m) => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`).join('\n');

      const prompt = `请用一段话总结以下对话的核心内容：\n\n${text}`;
      const summary = await this.llmService.chat([{ role: 'user', content: prompt }]);

      await this.sessionsService.updateSummary(sessionId, summary);
    } catch (err) {
      console.error('[Summarize Error]', err.message);
    }
  }
}
```

---

## 七、Controller 与 DTO

```typescript
// src/chat/chat.controller.ts
import { Controller, Post, Body, Param } from '@nestjs/common';
import { ChatService } from './chat.service';

class SendMessageDto {
  content: string;
}

@Controller('api/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post(':sessionId')
  async sendMessage(
    @Param('sessionId') sessionId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.handleMessage(sessionId, dto.content);
  }
}
```

```typescript
// src/chat/chat.module.ts
import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { SessionsModule } from '../sessions/sessions.module';
import { MessagesModule } from '../messages/messages.module';
import { MemoriesModule } from '../memories/memories.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [SessionsModule, MessagesModule, MemoriesModule, EmbeddingModule, LlmModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
```

---

## 八、Migration（建表 + pgvector 扩展）

TypeORM CLI 生成迁移：

```bash
npx typeorm migration:generate src/migrations/Init -d src/config/database.config.ts
```

在生成的迁移文件中确保加入：

```typescript
// migrations/xxxx-Init.ts
public async up(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);
  // ... TypeORM 自动生成的 CREATE TABLE
}
```

---

## 九、Python 向量服务（不变，职责更单一）

```python
# python/main.py
from fastapi import FastAPI
from pydantic import BaseModel
import onnxruntime as ort
import numpy as np

app = FastAPI()
sess = ort.InferenceSession("models/jina-embeddings-v2-base-zh.onnx")

class EmbedReq(BaseModel):
    text: str

@app.post("/embed")
def embed(req: EmbedReq):
    inputs = {"input": [req.text]}   # 具体 input key 看模型文档
    outputs = sess.run(None, inputs)
    return {"embedding": outputs[0][0].tolist()}

@app.post("/batch_embed")
def batch_embed(texts: list[str]):
    inputs = {"input": texts}
    outputs = sess.run(None, inputs)
    return {"embeddings": [v.tolist() for v in outputs[0]]}
```

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

## 十一、启动方式

```bash
# 1. 启动 PostgreSQL（Docker）
docker run -d --name pg \
  -e POSTGRES_PASSWORD=yourpassword \
  -e POSTGRES_DB=companion \
  -p 5432:5432 \
  -v pgdata:/var/lib/postgresql/data \
  ankane/pgvector:latest

# 2. 初始化数据库表
npx typeorm migration:run -d dist/config/database.config.js

# 3. 启动 Python 向量服务
cd python && uvicorn main:app --port 8000

# 4. 启动 NestJS
cd node && npm run start:dev
```

---

## 十二、与 Express 版的关键差异总结

| 维度 | Express 版 | NestJS 版 |
|------|-----------|-----------|
| 代码组织 | 平铺文件 | Module + Controller + Service 分层 |
| 数据库操作 | better-sqlite3 手写 SQL | TypeORM Repository + Raw SQL（向量） |
| 依赖注入 | 手动 require | `@Injectable()` 自动注入 |
| 配置管理 | 读 process.env 到处散落 | `@nestjs/config` 集中管理 |
| HTTP 客户端 | axios 手动实例 | `@nestjs/axios` 封装 + RxJS |
| 异步任务 | setImmediate | setImmediate（现阶段），后期可升 `@nestjs/bull` |
| 扩展性 | 加功能容易污染 | Module 隔离，加 WebSocket / GraphQL 即插即用 |
| 类型安全 | JSDoc 或裸写 | TypeScript 全链路类型 |

---

## 十三、后续可平滑升级的点

1. **流式响应**：Controller 返回值改为 `@Sse()`，LlmService 调 DeepSeek 时开 `stream: true`
2. **异步队列**：把 `setImmediate` 换成 `@nestjs/bull` + Redis，记忆提取和摘要进队列，可重试、可监控
3. **WebSocket 实时聊天**：加 `@nestjs/websockets` 模块，前端直接 `socket.emit('chat', msg)`
4. **多租户/用户系统**：`users` Module + JWT Guard，sessions/memories 加 `user_id` 字段
5. **jiwen 情绪引擎**：作为一个独立 Module，在 ChatService 里 `buildSystemPrompt` 时注入情绪状态

---

## 十四、第一周实施节奏

| 天数 | 任务 | 产出 |
|------|------|------|
| Day 1 | `nest new companion` 初始化，装 TypeORM/pg，连 PostgreSQL | `npm run start:dev` 不报错 |
| Day 2 | 建 Entity + Migration，写 Characters/Sessions CRUD | Postman 能创建角色和会话 |
| Day 3 | Messages CRUD + ChatService 基础对话（不接向量） | 能对角色发消息，收到回复 |
| Day 4 | Python FastAPI 跑起来，Nest 接 EmbeddingService | 能调通 `/embed` |
| Day 5 | MemoriesService（向量检索 + 写入），接入 ChatService | 聊天时能召回历史记忆 |
| Day 6 | 异步记忆提取 + 滚动摘要（setImmediate 版） | 后台自动拆解记忆 |
| Day 7 | 联调 + 修 bug + 补 `.env` 文档 | 完整体验长对话记忆 |
