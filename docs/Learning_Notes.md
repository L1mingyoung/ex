# AI 伴侣后端 —— 学习笔记

> 面向后端初学者的详细记录。每个步骤都解释：**是什么、为什么、怎么做**。
> 对照阅读：[Implementation_Plan.md](Implementation_Plan.md)（计划）和 `companion/src/`（源代码）。

---

## 零、后端基础概念速览

如果你对后端不太熟悉，先花 5 分钟看懂这几个核心概念，后面会反复出现：

### 一个 Web 后端做了什么？

```
你在浏览器/App 里发一条消息
        │
        ▼
┌─── HTTP 请求 ───────────────────────────┐
│  POST /api/chat/abc123                  │  ← URL 路径（路由）
│  Content-Type: application/json          │  ← 告诉服务器"我发的是 JSON"
│  {"content": "你好"}                     │  ← 请求体（数据）
└──────────────────────────────────────────┘
        │
        ▼
┌─── 服务器处理 ───────────────────────────┐
│  1. 接收请求，读取 JSON                    │
│  2. 查数据库，找历史记录                    │
│  3. 调 AI API，生成回复                    │
│  4. 保存回复到数据库                       │
└──────────────────────────────────────────┘
        │
        ▼
┌─── HTTP 响应 ───────────────────────────┐
│  HTTP 200 OK                            │  ← 状态码（200=成功）
│  {"reply": "你好呀，今天怎么样？"}         │  ← 响应体（结果）
└──────────────────────────────────────────┘
```

### 关键术语

| 术语 | 一句话解释 | 类比 |
|------|-----------|------|
| **HTTP** | 浏览器和服务器通信的语言 | 寄信的协议 |
| **API** | 服务器对外暴露的功能接口 | 餐厅菜单：你只能点菜单上有的 |
| **路由 (Route)** | URL 路径到处理函数的映射 | `/api/chat` → 聊天处理函数 |
| **Controller** | 接收 HTTP 请求的入口 | 餐厅服务员：接单 |
| **Service** | 处理业务逻辑 | 厨师：做菜 |
| **Repository** | 操作数据库（增删改查） | 冰箱：存取食材 |
| **Entity** | 数据库表对应的 JS 类 | 表格模板 |
| **ORM** | 把数据库行自动映射成 JS 对象 | 翻译官：SQL ↔ JS |
| **JSON** | 前后端通用的数据格式 | 通用信封 |
| **.env** | 存放密码/密钥的配置文件 | 保险箱 |
| **Docker** | 把软件打包成集装箱，到处可运行 | 集装箱 |

### NestJS 的请求处理流程

```
HTTP 请求进来
    │
    ▼
Controller（服务员：接单、验单）
    │  调用
    ▼
Service（厨师：做菜）
    │  调用
    ▼
Repository（冰箱：存取数据）
    │
    ▼
PostgreSQL（数据库）
```

---

## 2026-06-04 | Day 1 前置：Docker pgvector 环境搭建

### 背景：为什么需要 Docker？

项目需要 **PostgreSQL + pgvector 扩展**。pgvector 是一个让数据库能"理解"向量（AI 的记忆）的插件。

**问题：** Windows 版的 PostgreSQL 不带 pgvector，也无法手动安装（它是 C 语言写的，需要和 PG 一起编译）。

**解决：** Docker 里有一个叫 `ankane/pgvector` 的镜像，它把 PostgreSQL + pgvector 打包好了，直接跑就行。

> **Docker 镜像** = 软件安装包。**Docker 容器** = 运行中的软件实例。
> 类比：镜像是 `.exe` 安装文件，容器是双击运行后的程序。

### 一步步操作

#### 1. 检查电脑上有什么

```bash
# 查看 Node.js 版本（如果没装会报错）
# v 开头就是版本号，v22.22.2 表示 22.22.2 版本
node -v
# → v22.22.2 ✅  说明 Node.js 已安装，版本够新

# 查看 npm 版本（npm 是 Node 的包管理器，装 Node 时自带）
npm -v
# → 10.9.7 ✅

# 查看 Docker 是否在运行
# docker info 会输出 Docker 引擎的各种信息；如果 Docker 没启动，会报连接错误
docker info
# → "failed to connect to the docker API"  ❌ Docker Desktop 没启动

# 查看 NestJS 脚手架是否安装
# nest 命令是 NestJS 的项目创建工具
nest --version
# → "command not found"  ❌ 还没装

# 查看谁在占用 5432 端口
# netstat 显示网络连接状态；-ano 表示显示所有连接+数字端口+进程ID
# grep 5432 过滤出含 5432 的行（5432 是 PostgreSQL 默认端口）
netstat -ano | grep 5432
# → 端口被 PID 8220 占用：本地安装的 PostgreSQL 14 正在运行
```

#### 2. 安装 NestJS CLI

```bash
# npm install -g：全局安装，装完任何目录都能用 nest 命令
# @nestjs/cli：NestJS 官方脚手架，用来创建新项目、生成模块等
npm install -g @nestjs/cli
# → added 210 packages  ✅ 装好了
```

#### 3. 启动 Docker Desktop

```bash
# Docker Desktop 是 Windows 上的图形化 Docker 管理工具
# start "" 是 Windows 打开程序的方式
start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"

# Docker 引擎启动需要 15-30 秒，用循环等待
# for i in $(seq 1 12)：循环 12 次（每次等 5 秒 = 最多等 60 秒）
# docker info --format "{{.ServerVersion}}"：只输出 Docker 版本号
# && break：如果成功（Docker 就绪），跳出循环
for i in $(seq 1 12); do
  docker info --format "{{.ServerVersion}}" 2>&1 && break
  echo "等待 Docker 启动中... ($i/12)"
  sleep 5
done
# → Docker 29.4.0 ✅
```

#### 4. 启动 pgvector 容器

```bash
docker run -d --name companion-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=companion \
  -p 54321:5432 \
  -v companion-pgdata:/var/lib/postgresql/data \
  ankane/pgvector:latest
```

**逐个参数解释：**

| 参数 | 什么意思 | 为什么这样设 |
|------|---------|-------------|
| `docker run` | 创建并启动一个新容器 | |
| `-d` | detach，后台运行 | 终端关了容器也不停 |
| `--name companion-pg` | 给容器起名叫 `companion-pg` | 后面用这个名字操作它，比如 `docker start companion-pg` |
| `-e POSTGRES_PASSWORD=postgres` | 环境变量：设置数据库超级用户密码 | `-e` 是 environment 缩写。容器启动时读取这些变量 |
| `-e POSTGRES_DB=companion` | 环境变量：自动创建一个叫 `companion` 的数据库 | 不用手动 `CREATE DATABASE` |
| `-p 54321:5432` | 端口映射：`宿主机端口:容器内端口` | 外部访问 54321，转发到容器内的 5432。因为本地 PG 14 已占 5432 |
| `-v companion-pgdata:/var/lib/postgresql/data` | 数据卷挂载：`卷名:容器内路径` | 数据存宿主机，删容器不丢数据 |
| `ankane/pgvector:latest` | 镜像名 | `:latest` 是最新版。包含 PostgreSQL 15 + pgvector |

#### 5. 安装 pgvector 扩展

```bash
# docker exec：在运行中的容器里执行命令
# companion-pg：目标容器名
# psql：PostgreSQL 命令行客户端
# -U postgres：用 postgres 用户登录
# -d companion：连接到 companion 数据库
# -c "..."：执行后面的 SQL 语句
docker exec companion-pg psql -U postgres -d companion \
  -c "CREATE EXTENSION IF NOT EXISTS vector;"
# → CREATE EXTENSION  ✅

# 验证安装
docker exec companion-pg psql -U postgres -d companion \
  -c "SELECT extversion FROM pg_extension WHERE extname='vector';"
# → 0.5.1  ✅
```

### 当前架构图

```
┌──────────────────────────────────────────┐
│  你的电脑 (Windows 11)                     │
│                                          │
│  ┌─ 本地 PG 14 ────────── 端口 5432 ──┐  │
│  │  (你之前装的，项目不用它)             │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌─ Docker 容器 companion-pg ─────────┐  │
│  │  PostgreSQL 15 + pgvector 0.5.1     │  │
│  │  端口 54321（宿主机）→ 5432（容器内） │  │
│  │  数据库: companion                   │  │
│  │  用户: postgres / 密码: postgres     │  │
│  │  数据卷: companion-pgdata            │  │
│  └────────────────────────────────────┘  │
│              ↑                            │
│         项目连接这个                        │
└──────────────────────────────────────────┘
```

---

## 2026-06-04 | Day 1：项目初始化 + 数据库连接

### 1. 创建 NestJS 项目

```bash
# 进入到放项目的目录
cd d:/Code/AI

# nest new：创建新 NestJS 项目
# companion：项目名/文件夹名
# --skip-git：不自动初始化 git（我们手动管理）
# --package-manager npm：用 npm 装依赖（不用 yarn/pnpm）
# --strict：开启 TypeScript 严格模式（更严格的类型检查）
nest new companion --skip-git --package-manager npm --strict

# 进入项目目录
cd companion

# 装项目需要的额外依赖
npm install @nestjs/typeorm typeorm pg @nestjs/config @nestjs/axios axios class-validator class-transformer
```

### 2. 每个依赖做了什么？

```bash
npm install @nestjs/typeorm typeorm pg @nestjs/config @nestjs/axios axios class-validator class-transformer
```

| 包名 | 作用 | 为什么需要 |
|------|------|-----------|
| `@nestjs/typeorm` | NestJS 的 TypeORM 适配层 | 让 TypeORM 和 NestJS 的依赖注入系统配合工作 |
| `typeorm` | ORM 框架本身 | 把数据库行 ↔ JS 对象自动互转。不用手写 INSERT/ SELECT 语句 |
| `pg` | PostgreSQL 驱动（`node-postgres`） | TypeORM 底层通过它和 PG 通信。类比：JDBC 驱动 |
| `@nestjs/config` | 环境变量管理 | 集中读取 `.env` 文件，密码不散落在代码各处 |
| `@nestjs/axios` | NestJS 封装的 HTTP 客户端 | 调用外部 API（DeepSeek、Python 服务） |
| `axios` | HTTP 客户端底层库 | `@nestjs/axios` 依赖它 |
| `class-validator` | 请求参数验证 | `@IsString()`, `@IsNotEmpty()` 等装饰器 |
| `class-transformer` | 对象转换 | 把纯 JSON 转成带类型的 class 实例 |

### 3. 创建配置文件

#### `.env` 文件（环境变量）

```
d:\Code\AI\companion\.env
```

```env
DB_HOST=localhost      # 数据库地址（本机）
DB_PORT=54321          # 数据库端口（Docker pgvector 映射的端口）
DB_USER=postgres       # 数据库用户名
DB_PASSWORD=postgres   # 数据库密码
DB_NAME=companion      # 数据库名称
DEEPSEEK_API_KEY=sk-placeholder   # DeepSeek API 密钥（先用假的）
PYTHON_EMBED_URL=http://localhost:8000  # Python 向量服务地址
PORT=3000              # NestJS 服务器端口
```

**为什么要用 `.env`？**
- 密码不写死在代码里（安全）
- 不同环境用不同配置（开发/测试/生产）
- `.env` 不提交到 git（`.gitignore` 里排除），`.env.example` 提交（告诉别人有哪些配置项）

#### `src/app.module.ts`（根模块——应用入口）

```typescript
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),  // 加载 .env
    TypeOrmModule.forRoot({...}),              // 连接数据库
    CharactersModule, SessionsModule, ChatModule,  // 业务模块
  ],
})
export class AppModule {}
```

这是 NestJS 的根模块。项目的所有功能从这里开始组装。

**关键配置项解释：**

```typescript
TypeOrmModule.forRoot({
  type: 'postgres',                    // 数据库类型
  host: process.env.DB_HOST,           // 从 .env 读取
  port: parseInt(process.env.DB_PORT ?? '54321', 10),  // 字符串转数字
  // ...
  autoLoadEntities: true,  // 自动发现所有 Entity，不用手动列表
  synchronize: true,       // 开发模式：Entity 改了自动更新表结构
  logging: true,           // 控制台打印 SQL 语句（学习用）
})
```

| 配置项 | 解释 |
|--------|------|
| `autoLoadEntities: true` | 每个 Feature Module 用 `TypeOrmModule.forFeature([Entity])` 注册的 Entity 会被自动发现 |
| `synchronize: true` | **开发专用**。改了 Entity 属性，表结构自动跟着变。生产环境必须 `false`，用 Migration 管理 |
| `logging: true` | 每条 SQL 都打印到控制台。你可以在终端看到 `SELECT ...`, `INSERT ...` 等语句 |

### 4. Day 1 验收

```bash
# 启动开发服务器（支持热重载：改代码自动重启）
npm run start:dev

# 另开一个终端，测试服务器是否在响应
curl http://localhost:3000
# → "Hello World!"  ✅ 服务器跑起来了
```

如果看到 `Hello World!`，说明：
- NestJS 编译成功 ✅
- TypeORM 连接 PostgreSQL 成功 ✅
- HTTP 服务在 3000 端口监听 ✅

---

## 2026-06-04 | Day 2：Entity + CRUD

### 什么是 Entity？

Entity 是数据库表在代码里的映射。一张表对应一个 Entity 类，一行数据对应一个 Entity 实例。

```typescript
// 这是 Entity（代码）
@Entity('characters')
export class Character {
  @PrimaryColumn('text')
  id: string;      // 对应数据库列 id (text)

  @Column()
  name: string;    // 对应数据库列 name (varchar)

  @Column({ type: 'text', name: 'base_prompt' })
  basePrompt: string;  // 对应数据库列 base_prompt (text)
}

// 数据库里是这样的：
// ┌─────────┬────────┬──────────────────┐
// │ id      │ name   │ base_prompt      │
// ├─────────┼────────┼──────────────────┤
// │ xiaoya  │ 小雅   │ 你是小雅，25岁... │
// └─────────┴────────┴──────────────────┘
```

### 什么是 CRUD？

CRUD = 增删改查，四种最基本的数据库操作：

| 操作 | SQL | TypeORM Repository |
|------|-----|-------------------|
| **C**reate | `INSERT INTO characters VALUES (...)` | `repo.save(entity)` |
| **R**ead | `SELECT * FROM characters` | `repo.find()` |
| **U**pdate | `UPDATE characters SET ...` | `repo.save(entity)` ← 同上 |
| **D**elete | `DELETE FROM characters WHERE ...` | `repo.remove(entity)` |

NestJS 把 CRUD 拆成三层：

```
Controller（路由层：收到 HTTP 请求，调用 Service）
    │
Service（业务层：处理逻辑，调用 Repository）
    │
Repository（数据层：执行 SQL，返回结果）
```

### 创建的 Entity 清单

| Entity | 数据库表 | 主键方式 | 为什么这样选 |
|--------|---------|---------|-------------|
| Character | characters | `@PrimaryColumn('text')` 手动指定 | 角色 ID 是有意义的短名（如 "xiaoya"），不用自动生成 |
| Session | sessions | `@PrimaryGeneratedColumn('uuid')` | UUID 全局唯一，分布式友好 |
| Message | messages | `@PrimaryGeneratedColumn()` 自增整数 | 消息量大，自增整数性能最好 |
| MemoryChunk | memory_chunks | `@PrimaryGeneratedColumn()` 自增整数 | 同上，且 embedding 字段不映射 |

### 关键设计：为什么 MemoryChunk 的 embedding 字段不映射？

TypeORM 支持的标准 SQL 类型不包括 `VECTOR(768)`（这是 pgvector 扩展的自定义类型）。

**解决方案**（来自规格文档第七章）：
```
普通字段（id, content, memory_type...）
  → TypeORM @Column() 正常映射
  → 用 Repository 的 save/find 等 API 操作

向量字段（embedding VECTOR(768)）
  → TypeORM 不映射
  → 用 repo.query() 写原生 SQL 操作
```

### NestJS 依赖注入是怎么工作的？

这是 NestJS 最核心的概念。不需要 `new XxxService()`，框架自动帮你创建并注入：

```typescript
// ❌ 传统方式：自己 new
const repo = new Repository();
const service = new CharactersService(repo);

// ✅ NestJS 方式：声明依赖，框架自动注入
@Injectable()
export class CharactersService {
  constructor(
    @InjectRepository(Character)  // 告诉框架：我需要 Character 的 Repository
    private readonly repo: Repository<Character>,  // 框架自动创建并传入
  ) {}
}
```

**`@Injectable()` = 这个类可以被注入。**
**`@InjectRepository(Entity)` = 这个 Entity 的 Repository 请注入到这里。**

类比：你去餐厅，不需要自己进厨房找食材。告诉服务员你要什么（声明依赖），厨房系统自动给你送来（依赖注入）。

### 踩坑记录

**1. JSON 字段名 vs Entity 属性名**

```typescript
// 前端发来的 JSON（业界习惯 snake_case）
{ "base_prompt": "你是小雅..." }

// Entity 的 JS 属性（JS 习惯 camelCase）
@Column({ name: 'base_prompt' })  // ← name 参数只告诉 TypeORM 数据库列名
basePrompt: string;                // ← 这是 JS 属性名

// @Column({ name: 'base_prompt' }) 的意思：
// "数据库列名叫 base_prompt，但 JS 里我叫 basePrompt"
// 它只管数据库 ↔ Entity 的映射，不管 JSON ↔ Entity 的映射！

// ✅ 解决办法：Controller 里手动映射
create(@Body() body: CreateCharacterDto) {
  return this.service.create({
    basePrompt: body.base_prompt,  // snake_case → camelCase
  });
}
```

**2. `synchronize: true` 的利弊**

| | synchronize: true | Migration |
|---|---|---|
| 怎么用 | 改 Entity → 重启 → 表自动更新 | 改 Entity → 生成 migration → 执行 migration |
| 优点 | 快速，适合早期开发 | 有版本历史，可回滚 |
| 缺点 | 删列会丢数据，无历史 | 多一步操作 |
| 适用 | **现在这个阶段** | 上线前 |

### Day 2 验收

```bash
# ========== 创建角色 ==========
curl -X POST http://localhost:3000/api/characters \
  -H "Content-Type: application/json" \
  -d '{"id":"xiaoya","name":"小雅","base_prompt":"你是小雅，25岁，温柔体贴"}'
# → {"id":"xiaoya","name":"小雅","basePrompt":"你是小雅...","model":"deepseek-chat"}

# ========== 获取所有角色 ==========
curl http://localhost:3000/api/characters
# → [{"id":"xiaoya",...}]   ← 数组，每个元素是一个角色

# ========== 获取单个角色 ==========
curl http://localhost:3000/api/characters/xiaoya
# → {"id":"xiaoya","name":"小雅",...}

# ========== 创建会话 ==========
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"characterId":"xiaoya"}'
# → {"id":"6519cabb-...","characterId":"xiaoya","messageCount":0}

# ========== 获取所有会话 ==========
curl http://localhost:3000/api/sessions

# ========== 验证数据库表 ==========
docker exec companion-pg psql -U postgres -d companion -c "\dt"
# → characters | messages | sessions  (3 tables)
```

---

## 2026-06-04 | Day 3：基础对话流程

### 这个系统调用 DeepSeek 的完整链路

```
用户输入 "你好呀，今天心情不好"
        │
        ▼
┌─ ChatController ────────────────────────────┐
│  POST /api/chat/:sessionId                  │
│  收到 { content: "你好呀..." }               │
│  调用 ChatService.handleMessage()           │
└──────────────────────────────────────────────┘
        │
        ▼
┌─ ChatService（核心编排）─────────────────────┐
│                                              │
│  [1] MessagesService.create()               │
│      用户消息 → INSERT INTO messages         │
│                                              │
│  [2] SessionsService.findOne()              │
│      查出 session，知道关联哪个角色            │
│      CharacterRepo.findOne()                │
│      查出角色的 base_prompt                  │
│      MessagesService.findRecent(10)         │
│      取出最近 10 条历史消息                   │
│                                              │
│  [3] buildSystemPrompt()                    │
│      拼出 system prompt：                    │
│        "你是小雅...\n\n请用符合性格的方式回复"  │
│                                              │
│  [4] LlmService.chat(messages)              │
│      → HTTP POST DeepSeek API               │
│      → 等待 AI 生成回复                      │
│                                              │
│  [5] MessagesService.create()               │
│      AI 回复 → INSERT INTO messages         │
│                                              │
│  [6] SessionsService.incrementCount()       │
│      message_count++                        │
│                                              │
│  [7] return { reply: "哎呀呀..." }          │
│      把回复返回给前端                         │
└──────────────────────────────────────────────┘
```

### 发给 DeepSeek 的 messages 数组长什么样？

```json
[
  {
    "role": "system",
    "content": "你是小雅，25岁，温柔体贴...\n\n请记住以上信息，用符合你性格的方式回复。"
  },
  { "role": "user", "content": "你好呀，今天心情不太好，工作压力很大" }
]
```

`system` 角色 = 给 AI 设定人设和规则。后面的 `user`/`assistant` 交替是对话历史。

### System Prompt 四层叠加

```
┌──────────────────────────────────────────┐
│ 第 1 层：固定人格 (base_prompt)            │  Day 3 ✅
│ "你是小雅，25岁，温柔体贴，说话喜欢用       │
│  呢和呀结尾..."                            │
├──────────────────────────────────────────┤
│ 第 2 层：滚动摘要 (summary)                │  Day 6 ⏳
│ 把超过 50 条的旧消息压缩成一段摘要          │
├──────────────────────────────────────────┤
│ 第 3 层：动态记忆 (向量检索)               │  Day 5 ⏳
│ 从数据库中向量搜索最相关的记忆碎片          │
│ - "用户住在北京"                           │
│ - "用户喜欢猫"                             │
├──────────────────────────────────────────┤
│ 第 4 层：指令约束                          │  Day 3 ✅
│ "请记住以上信息，用符合你性格的方式回复"    │
└──────────────────────────────────────────┘
```

### Day 3 验收

#### 第一阶段：用占位符 Key 验证流程（即使 AI 没回复也能验证流程正确）

```bash
curl -X POST http://localhost:3000/api/chat/{sessionId} \
  -H "Content-Type: application/json" \
  -d '{"content":"你好呀"}'

# 返回: 500 Internal Server Error
# 错误详情: "Authentication Fails, Your api key: ****lder is invalid"
#
# 虽然报错了，但这不是 bug！它证明了：
# ✅ 用户消息已写入 messages 表
# ✅ 角色配置已从 characters 表读出
# ✅ System prompt 已组装
# ✅ 已发出 HTTP 请求到 DeepSeek 服务器
# ✅ DeepSeek 服务器收到了请求，只是拒绝了这个假 Key
```

#### 第二阶段：填入真实 API Key 后的端到端测试

1. 打开 `d:\Code\AI\companion\.env`
2. 把 `DEEPSEEK_API_KEY=sk-placeholder` 改成你的真实 Key
3. 重启服务器（改 `.env` 需要重启才能生效）

```bash
# 步骤 1：创建测试角色
curl -X POST http://localhost:3000/api/characters \
  -H "Content-Type: application/json" \
  -d '{"id":"test_chat","name":"小雅","base_prompt":"你是小雅，25岁，温柔体贴，说话喜欢用呢和呀结尾"}'

# 步骤 2：创建会话
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"characterId":"test_chat"}'
# 记下返回的 id（会话 ID），后面要用

# 步骤 3：发消息（用 Node.js 发送，保证中文不乱码）
node -e "
const http = require('http');
const data = JSON.stringify({content: '你好呀，今天心情不太好'});
const req = http.request({
  hostname: 'localhost', port: 3000,
  path: '/api/chat/替换为你的会话ID',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
}, res => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {
    const r = JSON.parse(body);
    console.log('AI 回复:', r.reply);
  });
});
req.write(data);
req.end();
"

# 步骤 4：查看数据库确认
docker exec companion-pg psql -U postgres -d companion \
  -c "SELECT role, content FROM messages ORDER BY id DESC LIMIT 4;"
```

---

## 🧪 测试指南：如何验证 API 是否正常

### 核心思路

测试后端 API 的本质：**模拟前端发 HTTP 请求，检查服务器返回什么**。

你需要知道：
1. **URL**：请求发到哪（如 `http://localhost:3000/api/characters`）
2. **方法**：GET（查）、POST（增）、DELETE（删）等
3. **请求头**：`Content-Type: application/json`（告诉服务器数据格式）
4. **请求体**：POST 时带的 JSON 数据
5. **预期响应**：服务器应该返回什么

### 方法 1：终端 curl 命令（最原始、最快）

**⚠️ 重要：Windows bash + curl 传中文会损坏数据！**

这不是服务器的问题，是 Windows 终端的问题。bash on Windows 默认用 GBK 编码，而服务器期望 UTF-8。中文经过 bash → curl → 服务器的链路后会被转成单字节乱码。

```bash
# ❌ 危险：中文会被损坏存入数据库
curl -X POST http://localhost:3000/api/chat/xxx \
  -H "Content-Type: application/json" \
  -d '{"content":"你好"}'     # → 数据库中变成 "???" (单字节乱码)

# ✅ curl 只能可靠地用于英文和简单 ASCII 测试
curl http://localhost:3000/api/characters   # 查数据 OK
curl -X POST ... -d '{"content":"hello"}'  # 英文 OK
```

**如何验证数据是否损坏？** 在数据库中看 `char_length(content)` 和 `length(content)`：
- 正确：`char_length=15, length=45`（UTF-8 中每个中文 3 字节）
- 损坏：`char_length=15, length=15`（单字节编码，每个中文变成了 1 个乱码字节）

### 方法 2：Node.js 脚本（推荐给开发者）

**为什么推荐？** Node.js 原生支持 UTF-8，中文不会损坏。而且可以写成文件反复用。

创建文件 `d:\Code\AI\companion\test_chat.js`：

```javascript
/**
 * 测试聊天 API 的脚本
 *
 * 使用方法：
 *   1. 先在下面填入你的 sessionId
 *   2. 终端运行: node test_chat.js
 *   3. 修改 content 变量可以发不同消息
 */

const http = require('http');  // Node.js 内置的 HTTP 模块

const SESSION_ID = '你的会话ID';   // ← 改成你的
const MESSAGE = '你好呀，今天怎么样？';  // ← 改成你想发的消息

function chat(sessionId, content) {
  // 1. 把消息内容打包成 JSON 字符串
  const postData = JSON.stringify({ content: content });

  // 2. 配置请求参数
  const options = {
    hostname: 'localhost',   // 服务器地址（本机）
    port: 3000,              // 服务器端口
    path: '/api/chat/' + sessionId,  // API 路径
    method: 'POST',          // HTTP 方法
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),  // 数据长度（必须）
    },
  };

  // 3. 发起请求
  const req = http.request(options, (res) => {
    let body = '';

    // 接收数据（可能分多次到达，所以要拼接）
    res.on('data', (chunk) => {
      body += chunk;
    });

    // 数据接收完毕
    res.on('end', () => {
      const result = JSON.parse(body);  // JSON 字符串 → JS 对象
      console.log('状态码:', res.statusCode);
      console.log('AI 回复:', result.reply || JSON.stringify(result));
    });
  });

  // 处理网络错误
  req.on('error', (err) => {
    console.error('请求失败:', err.message);
  });

  // 4. 发送请求体
  req.write(postData);
  req.end();
}

// 执行
chat(SESSION_ID, MESSAGE);
```

运行：
```bash
cd d:/Code/AI/companion
node test_chat.js

# 输出示例：
# 状态码: 201 (NestJS POST 默认返回 201 Created)
# AI 回复: 哎呀呀，心情不好呀？来跟小雅说说怎么啦～
```

### 方法 3：VS Code REST Client（最方便，强烈推荐）

安装 VS Code 插件 **"REST Client"**（作者 Huachao Mao）。

然后创建文件 `d:\Code\AI\test.http`，内容：

```http
### 变量：基础 URL
@baseUrl = http://localhost:3000

### ========================================
### 角色管理
### ========================================

### 创建角色
POST {{baseUrl}}/api/characters
Content-Type: application/json

{
  "id": "xiaoya",
  "name": "小雅",
  "base_prompt": "你是小雅，25岁，温柔体贴，说话喜欢用呢和呀结尾。对用户友善关心。"
}

### 获取所有角色
GET {{baseUrl}}/api/characters

### 获取指定角色
GET {{baseUrl}}/api/characters/xiaoya

### 删除角色
DELETE {{baseUrl}}/api/characters/xiaoya

### ========================================
### 会话管理
### ========================================

### 创建会话
POST {{baseUrl}}/api/sessions
Content-Type: application/json

{
  "characterId": "xiaoya"
}

### 获取所有会话
GET {{baseUrl}}/api/sessions

### 获取指定会话
GET {{baseUrl}}/api/sessions/你的会话ID

### ========================================
### 聊天
### ========================================

### 发送消息
POST {{baseUrl}}/api/chat/你的会话ID
Content-Type: application/json

{
  "content": "你好呀，今天心情不太好，工作压力很大"
}
```

**使用方法：** 每个 `###` 注释下面是一个请求块。点击 `Send Request` 文字（会出现在 `POST`/`GET` 上方），右侧窗口显示响应结果。

**优点：** 中文完美支持，可以保存请求历史，可以定义变量。

### 方法 4：直接查数据库

有时候 API 返回正确但你想确认数据真的入库了：

```bash
# 查看所有表
docker exec companion-pg psql -U postgres -d companion -c "\dt"

# 查看某张表的结构（有哪些列、什么类型）
docker exec companion-pg psql -U postgres -d companion -c "\d messages"

# 查看角色的所有数据
docker exec companion-pg psql -U postgres -d companion \
  -c "SELECT * FROM characters;"

# 查看最近 5 条消息
docker exec companion-pg psql -U postgres -d companion \
  -c "SELECT id, role, content, created_at FROM messages ORDER BY id DESC LIMIT 5;"

# 统计各表有多少条数据
docker exec companion-pg psql -U postgres -d companion \
  -c "SELECT 'characters' as 表名, count(*) as 行数 FROM characters
      UNION ALL SELECT 'sessions', count(*) FROM sessions
      UNION ALL SELECT 'messages', count(*) FROM messages;"
```

---

## 📋 调试技巧

### 服务器不响应？

```bash
# 1. 检查端口是否在监听
netstat -ano | grep 3000
# 如果没输出 → 服务器没启动

# 2. 检查 Docker 是否在运行
docker ps
# 应该看到 companion-pg 在列表里

# 3. 如果 Docker 没启动
docker start companion-pg
```

### 改代码后没生效？

```bash
# 使用 npm run start:dev（不是 npm run start）
# start:dev = start --watch = 文件变更自动重启
npm run start:dev
```

### 想看完整的 SQL 日志？

在 `src/app.module.ts` 里已经设置了 `logging: true`，每次数据库操作都会打印 SQL 到控制台。这是学习 ORM 最好的方式。

### 端口被占用？

```bash
# 查看谁在占用 3000 端口
netstat -ano | grep ":3000 "

# 最后一列是 PID（进程 ID），杀掉它
# 例如 PID 是 27476：
powershell -Command "Stop-Process -Id 27476 -Force"
```

---

## 环境快照（Day 6 更新）

| 组件 | 版本 | 端口 | 备注 |
|------|------|------|------|
| Node.js | v22.22.2 | - | |
| npm | 10.9.7 | - | |
| NestJS CLI | 11.x | - | |
| TypeScript | 5.9.3 | - | |
| TypeORM | 1.0.0 | - | ESM-only |
| Python | 3.12.13 (uv) | - | 通过 uv 管理 |
| uv | 0.11.7 | - | Python 包管理器 |
| FastAPI | 0.136.3 | 8000 | Mock 模式 |
| PostgreSQL + pgvector | 15 (Docker) | 54321 | 4 张表 |
| Docker Desktop | 29.4.0 | - | |
| NestJS + Web 前端 | - | 3000 | API + 静态文件 |
| Git | 2.41.0 | - | |
| GitHub | - | - | https://github.com/L1mingyoung/ex |

### 数据库表

| 表名 | 管理方式 | 状态 |
|------|---------|------|
| characters | TypeORM Entity | ✅ |
| sessions | TypeORM Entity | ✅ |
| messages | TypeORM Entity | ✅ |
| memory_chunks | 手动 SQL（含 VECTOR(768)） | ✅ 4 张表完整 |

### 日常操作

```bash
# ─── Docker ───
docker start companion-pg       # 启动数据库容器
docker stop companion-pg        # 停止容器
docker exec companion-pg psql -U postgres -d companion  # 进数据库

# ─── Python Embedding 服务 ───
cd python
MOCK_EMBEDDING=1 uv run uvicorn main:app --port 8000   # Mock 模式
uv run uvicorn main:app --port 8000                    # 真实模式（需模型）

# ─── NestJS ───
cd companion
npm run start:dev               # 开发模式（热重载）
npm run build                   # 编译
npx tsc --noEmit                # 仅类型检查

# ─── API 测试 ───
curl http://localhost:3000/api/characters
curl http://localhost:3000/api/sessions
node test_chat.js               # Node.js 脚本测试聊天
```

---

## 2026-06-04 | Day 4：Python Embedding 服务

### 背景：为什么需要一个 Python 服务？

NestJS（Node.js）本身不能做 AI 模型的 Embedding 推理。Embedding 模型（Jina v2 base zh）是用 PyTorch/ONNX 训练的，只能在 Python 里跑。

**架构决策（最终方案第四章）：**
- Python 只做一件事：文本 → 768 维向量
- 检索由 PostgreSQL 的 pgvector 做（不经过 Python）
- NestJS 通过 HTTP 调用 Python 的 `/embed` 端点

### uv 包管理器

项目使用 `uv` 代替传统的 `pip`：
- `uv` 是用 Rust 写的，比 pip 快 10-100 倍
- 自动管理虚拟环境（类似 npm 的 `node_modules`）
- `uv sync` = `pip install -r requirements.txt` 但更快

```bash
# 已有 Python 3.12.13（通过 uv 安装）
uv python list --only-installed

# 创建项目、装依赖
cd python
uv sync    # 读取 pyproject.toml，自动装所有依赖
```

### pyproject.toml（Python 版的 package.json）

```toml
[project]
name = "companion-embedding"
requires-python = ">=3.10"
dependencies = [
    "fastapi>=0.115.0",     # Web 框架
    "uvicorn[standard]>=0.34.0",  # ASGI 服务器
    "onnxruntime>=1.20.0",  # ONNX 模型推理引擎
    "numpy>=2.0.0",         # 数值计算
]
```

### FastAPI 服务结构

```
python/
├── pyproject.toml      # 依赖声明
├── main.py             # FastAPI 入口（/embed, /batch_embed, /health）
├── embedder.py         # ONNX Runtime 封装
├── .venv/              # 虚拟环境（自动创建）
└── models/             # ONNX 模型文件（待下载）
```

### Mock 模式设计

在真实的 Jina ONNX 模型（~500MB）下载之前，先用 Mock 模式跑通流程：

```python
# Mock 模式：生成确定性随机向量
# 同一文本总是生成同一向量（用 hash 做 seed）
def embed(text: str) -> list[float]:
    random.seed(hash(text) % (2**31))
    return [random.random() for _ in range(768)]
```

```bash
# 启动 Mock 模式
MOCK_EMBEDDING=1 uv run uvicorn main:app --port 8000
# → /health → {"status":"ok","mock_mode":true,"dimensions":768}
```

### 踩坑：Windows 终端 GBK 编码

```python
# ❌ 报错 UnicodeEncodeError: 'gbk' codec can't encode character '⚠'
print("[Embedder] ⚠️  使用 MOCK 模式")

# ✅ Windows 终端不能输出 emoji，改用纯 ASCII
print("[Embedder] [MOCK MODE] Using random vectors")
```

### NestJS端 EmbeddingService

```typescript
@Injectable()
export class EmbeddingService {
  // 通过 HTTP 调 Python FastAPI
  async embed(text: string): Promise<number[]> {
    const { data } = await firstValueFrom(
      this.httpService.post(`${this.pythonUrl}/embed`, { text })
    );
    return data.embedding;  // → [0.123, -0.456, ...]  (768 numbers)
  }
}
```

### Day 4 验收

```bash
# Terminal 1: Python 服务
cd python && MOCK_EMBEDDING=1 uv run uvicorn main:app --port 8000

# Terminal 2: NestJS（自动连接 Python）
cd companion && npm run start:dev
# 日志: [EmbeddingService] Python Embedding 服务地址: http://localhost:8000

# 测试
curl http://localhost:8000/health
# → {"status":"ok","mock_mode":true,"dimensions":768}

curl -X POST http://localhost:8000/embed -H "Content-Type: application/json" -d '{"text":"hello"}'
# → {"embedding":[0.xxx, ...]}  ← 768 个数字
```

---

## 2026-06-04 | Day 5：记忆系统（向量检索 + 写入）

### 核心问题：TypeORM synchronize 会破坏 VECTOR 列

这是本阶段最大的坑。

**问题：** `memory_chunks` 表有 `embedding VECTOR(768)` 列，但 TypeORM Entity 里没映射这个列（因为 ORM 不支持）。当 `synchronize: true` 时，TypeORM 检测到 Entity 和 表结构不匹配，会执行：

```sql
-- TypeORM 自动执行的破坏性操作：
ALTER TABLE "memory_chunks" DROP COLUMN "embedding"  -- 把向量列删了！
DROP INDEX "idx_memory_embedding"                     -- 把 hnsw 索引删了！
ALTER TABLE "memory_chunks" DROP CONSTRAINT "memory_chunks_session_id_fkey"
```

**解决方案：** `memory_chunks` 表完全不用 TypeORM Entity 管理。

```typescript
// MemoriesModule — 不注册 TypeOrmModule.forFeature()
@Module({
  imports: [EmbeddingModule],  // ← 没有 TypeOrmModule！
  providers: [MemoriesService],
  exports: [MemoriesService],
})

// MemoriesService — 直接用 DataSource 写原生 SQL
@Injectable()
export class MemoriesService {
  constructor(
    private readonly db: DataSource,  // ← 不注入 Repository，注入 DataSource
    private readonly embeddingService: EmbeddingService,
  ) {}

  async search(sessionId: string, queryEmbedding: number[], limit = 5) {
    return this.db.query(`
      SELECT id, content, memory_type,
             1 - (embedding <=> $1::vector) AS similarity
      FROM memory_chunks WHERE session_id = $2
      ORDER BY embedding <=> $1::vector LIMIT $3
    `, [vectorStr, sessionId, limit]);
  }
}
```

### hnsw 索引是什么？

`hnsw` = Hierarchical Navigable Small World（分层可导航小世界图），是 pgvector 的高性能近似最近邻搜索索引。

```sql
CREATE INDEX idx_memory_embedding ON memory_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

| 参数 | 含义 | 调大效果 |
|------|------|---------|
| `m=16` | 每个节点最大连接数 | 更精确但占更多空间 |
| `ef_construction=64` | 构建时搜索深度 | 更精确但构建更慢 |

### 查重机制

用 cosine similarity 判断新记忆和已有记忆是否重复：

```
1 - (新向量 <=> 旧向量) > 0.95  →  视为重复，跳过不写入
```

这防止"用户住在北京"被反复提取 5 次。

### Day 5 验收

在 NestJS 控制台日志中看到记忆检索 SQL 正确执行：

```sql
-- 每次聊天时自动执行
SELECT id, content, memory_type,
       1 - (embedding <=> '[0.1,0.2,...]'::vector) AS similarity
FROM memory_chunks
WHERE session_id = 'xxx'
ORDER BY embedding <=> '[0.1,0.2,...]'::vector
LIMIT 5
```

---

## 2026-06-04 | Day 6：异步记忆提取 + 滚动摘要

### 为什么异步？

记忆提取需要额外调一次 DeepSeek API，会额外花费 2-5 秒。如果同步等待，用户发一条消息要多等几秒才能看到回复。

**解决方案：** `setImmediate()` —— 把提取任务推迟到回复返回之后执行。

```typescript
async handleMessage(sessionId, userContent) {
  // ════ 同步部分（用户等待，~3秒） ════
  // 1-8. 保存消息 → 检索记忆 → 调 LLM → 返回 reply

  const reply = await this.llmService.chat(...);
  // ← 到这里用户就收到回复了

  // ════ 异步部分（后台执行，用户不等待） ════
  setImmediate(() => {
    this.extractMemory(sessionId, userContent, reply, userMsgId);
  });
  setImmediate(() => {
    this.checkAndSummarize(sessionId);
  });

  return { reply };
}
```

### 记忆提取 Prompt 设计

提取 prompt 需要精心设计，否则 LLM 会提取出无意义的内容：

```
从以下对话中提取关于用户的事实、偏好或情绪碎片。
每条一行，格式：[类型] 内容。没有值得提取的信息就输出"无"。

类型说明：
  [事实] - 客观信息（居住地、职业、年龄、经历等）
  [偏好] - 喜好和习惯（喜欢什么、讨厌什么、习惯做什么）
  [情绪] - 情绪状态（开心、焦虑、疲惫、期待等）

对话：
用户：我刚搬到北京工作...
AI：哎呀呀，北京很好呀...

提取结果：
[事实] 用户刚搬到北京
[事实] 用户是一名软件工程师
[事实] 用户养了一只叫小咪的猫
```

**注意：** 提取用 `temperature: 0.3`（低温），因为这是准确性任务，不需要创造性。

### 实际运行日志

```
[Memory] 事实: 用户刚搬到新城市
[Memory] 事实: 用户是一名老师
[Memory] 事实: 用户养了一只小奶猫
[Memory] 事实: 用户养了一只猫，猫喜欢在窗台上晒太阳
[Memory] 情绪: 用户对猫有情感依恋，语气中带有期待和温暖
```

### 滚动摘要设计

```typescript
// 触发条件
if (session.messageCount < 50) return;          // 消息不够 50 条
if (session.updatedAt > oneHourAgo) return;     // 距离上次不够 1 小时

// 流程：读 50 条 → LLM 压缩 → 更新 session.summary → 重置 count
```

摘要内容会被拼入 system prompt 第二层：「【你们之前的对话摘要】...」

### Day 6 验收

当前 4 层 Prompt 全部实现：

```
┌──────────────────────────────────────────┐
│ ✅ 第一层：固定人格 (base_prompt)          │
│ ✅ 第二层：滚动摘要 (summary)              │
│ ✅ 第三层：动态记忆 (向量检索)              │
│ ✅ 第四层：指令约束                        │
└──────────────────────────────────────────┘
```

异步日志确认记忆提取 + 查重 + 入库全流程正常。

---

## 2026-06-04 | Day 7：SSE 流式 + Web 前端 + 适配器

### SSE 流式响应

**为什么需要流式？** 同步模式下用户发送消息后要等 3-8 秒才能看到完整回复。流式模式下 AI 每生成一个字就推送一次，体验更即时。

**实现方式：**

1. **LlmService.chatStream()** — 用 Node.js 原生 `https.request()` 连接 DeepSeek，逐 chunk 解析 SSE 数据：
   ```
   data: {"choices":[{"delta":{"content":"你"}}]}  → emit "你"
   data: {"choices":[{"delta":{"content":"好"}}]}  → emit "好"
   data: [DONE]                                    → complete
   ```

2. **ChatService.handleMessageStream()** — 返回 RxJS `Observable<string>`，流结束后异步保存回复

3. **ChatController** — `POST /api/chat/:id/stream`，设置 `Content-Type: text/event-stream`

### Web 聊天前端

**设计原则：** API 层（`api.js`）纯函数无 DOM 依赖，UI 层（`chat.js`）只做展示。切换平台只需换 API 层的 `fetch()` 实现。

```
client/
├── index.html          # 侧边栏 + 聊天区布局
├── css/style.css       # 深色侧边栏 + 移动端响应式
└── js/
    ├── api.js          # 纯 HTTP 调用（fetch + SSE 解析）
    └── chat.js         # UI 逻辑（DOM 操作）
```

**功能清单：**
- 左侧：角色列表（创建/选择/编辑）、会话列表（新建/切换/删除）
- 右侧：消息区（自动滚动）、输入区（Enter 发送）、流式逐字显示
- 状态指示：在线 / 回复中 / 错误
- 移动端适配：小屏自动切换为上下布局

### 角色编辑功能

`PUT /api/characters/:id` — 修改角色名称/人格/模型。前端角色列表旁有 ✎ 按钮。

### 平台适配器

```
adapters/
├── miniprogram/api.js      # wx.request() 替换 fetch()
├── miniprogram/api-uni.js  # uni.request() 跨端统一
└── qq-bot/adapter.js       # QQ Bot WebSocket → HTTP API
```

所有适配器函数签名相同，切换平台只需改 `import` 路径。

### 接入聊天软件分析

| 平台 | 接入方式 | 流式 | 难度 |
|------|---------|------|------|
| Web | fetch + SSE | ✅ | ⭐ 已完成 |
| 微信小程序 | wx.request | ❌ | ⭐⭐ 已有适配器 |
| uni-app | uni.request | ❌ | ⭐⭐ 已有适配器 |
| React Native | fetch | ✅ | ⭐ 可直接用 api.js |
| QQ Bot | WebSocket | ❌ | ⭐⭐ 需 SDK |
| Telegram Bot | Webhook | ❌ | ⭐ 简单 HTTP |

**核心结论：** NestJS API 是唯一数据源，所有平台接入 = 写 HTTP 适配器（~50行），不碰业务逻辑。

### GitHub 发布

```bash
git init && git add -A
git commit -m "feat: AI Companion backend + web chat"
git remote add origin https://github.com/L1mingyoung/ex.git
git push -u origin main --force
```

54 个文件已上传，`.env` 通过 `.gitignore` 排除。

---

## 环境快照

---

## 2026-06-04 | Day 8：稳定化修复

### 1. 滚动摘要为什么之前不会触发

原逻辑用 `session.updatedAt` 判断“距离上次摘要是否超过 1 小时”。但每次聊天结束都会更新会话，所以 `updatedAt` 总是很新，摘要检查几乎必然 return。

修复后新增 `last_summary_at`：

```typescript
if (session.messageCount < 50) return;
if (session.lastSummaryAt && session.lastSummaryAt > oneHourAgo) return;
```

摘要成功后调用 `markSummarized()`，同时写入 `summary`、清零 `message_count`、更新 `last_summary_at`。这样 `message_count` 表示“上次摘要之后的新消息数”，语义更准确。

### 2. 为什么关闭 TypeORM synchronize

`memory_chunks` 有 `embedding vector(768)` 字段，TypeORM Entity 没有映射这个字段。如果开启 `synchronize: true`，ORM 可能尝试把这个列删掉。现在改为：

- `synchronize: false`
- 启动时执行 `InitPgvectorSchema1710000000000`
- migration 负责 `CREATE EXTENSION vector`、建表、建 HNSW 索引

### 3. 真实 embedding 模型接入方式

默认仍可用 Mock 快速联调：

```bash
MOCK_EMBEDDING=1 uv run uvicorn main:app --port 8000
```

真实模式先下载模型：

```bash
uv run python scripts/download_model.py
uv run uvicorn main:app --port 8000
```

模型默认路径：`python/models/jina-embeddings-v2-base-zh.onnx`。如果放在别处，可设置 `EMBEDDING_MODEL_PATH`。

### 4. 真实 ONNX 模型不是直接吃字符串

下载 `jinaai/jina-embeddings-v2-base-zh` 后，实际 ONNX 输入节点是：

```text
input_ids: tensor(int64)
attention_mask: tensor(int64)
```

所以不能把字符串直接丢给 ONNX Runtime。正确流程是：

```text
中文文本
  -> tokenizer.json 分词
  -> input_ids + attention_mask
  -> ONNX Runtime 输出 last_hidden_state
  -> attention mask mean pooling
  -> L2 normalize
  -> 768 维向量
```

验证命令：

```powershell
cd D:\Code\ex\python
.\.venv\Scripts\python.exe -c "from embedder import Embedder; e=Embedder(); v=e.embed('你好世界'); print(len(v)); print(round(sum(x*x for x in v), 6))"
```

验证结果：

```text
768
1.0
```

这说明真实 embedding 链路已经从“文件下载”推进到“可实际生成向量”。

---

## 2026-06-04 | Day 9：jiwen 情绪引擎 + 微信聊天记录导入

### jiwen 的第一版为什么先用规则词典

情绪识别会在每次用户发消息时执行。如果每次都额外调用 LLM，会让聊天延迟和成本上升。第一版先用轻量规则词典：

```text
用户文本 -> 关键词/标点特征 -> emotion_snapshot -> prompt 情绪层
```

`emotion_snapshot` 会保存到 `messages.emotion_snapshot`，例如：

```json
{
  "joy": 0,
  "sadness": 0,
  "anxiety": 0.34,
  "fatigue": 0.34,
  "dominant": "anxiety",
  "valence": 0.35,
  "arousal": 0.48
}
```

Prompt 新增一层：

```text
【jiwen 情绪状态】
用户当前情绪：焦虑/担心（情绪倾向：偏消极，强度：中等）。回复时先接住情绪，再推进内容。
```

### 微信聊天记录导入的解析策略

第一优先级支持微信导出/复制常见格式：

```text
2026-06-04 21:18:03 我
今天加班好累
2026-06-04 21:19:10 小雅
辛苦啦，我陪你缓一下
```

解析逻辑：

1. 识别“时间 + 发送人”作为消息头
2. 后续多行作为同一条消息正文
3. 遇到下一个消息头时 flush 上一条消息
4. 根据 `userAliases` / `assistantAliases` 判定 role
5. 写入 `messages`，用户消息同时写入 jiwen 快照

导入 API：

```text
POST /api/import/chat-records
```

导入后后台继续做两件事：

- 对导入记录分块提取长期记忆，写入 `memory_chunks`
- 对最近导入内容生成摘要，写入 `session.summary`
- 对导入记录提取长期人格/关系画像，写入 `sessions.import_profile`

下一步可以增强：微信特殊消息过滤、图片/语音/撤回标记处理、导入预览确认、画像版本化。


## 2026-06-04 学习笔记：导入后的长期人格/关系画像

### 为什么需要“画像”，而不是只做摘要

批量导入聊天记录有三种长期价值：

1. 补历史消息：让数据库里有真实上下文。
2. 生成滚动摘要：把最近导入内容压缩成一段中期上下文。
3. 提取长期画像：从大量历史里抽出稳定的人格、偏好、沟通方式和关系状态。

摘要更像“发生过什么”，画像更像“这个人长期是什么样、我们之间应该怎么相处”。后续聊天时，AI 不应该只知道用户昨天说了什么，还要知道用户长期的表达习惯、情绪模式、边界和希望被支持的方式。

### 为什么画像放在 Session JSONB

这次选择把画像放在 `sessions.import_profile`，而不是新建全局用户表或独立画像表。

原因：

- 当前项目还没有多用户系统，`Session` 是最清晰的关系边界。
- 画像描述的是“当前用户和当前角色/会话”的关系，不一定适合全局复用。
- JSONB 能先承载结构化数据，后续字段调整成本低。
- ChatService 读取 session 时天然能拿到画像，不需要额外查询新表。

代价也要记住：

- JSONB 不适合复杂查询，比如“找出所有亲密度 high 的会话”。
- 没有版本历史，后续画像被覆盖后不方便审计。
- 如果未来支持多用户、多角色共享画像，可能需要迁移到 `relationship_profiles` 表。

### 画像 schema 的含义

`userPersona` 关注用户长期稳定特征：

```json
{
  "stableFacts": ["稳定事实"],
  "preferences": ["偏好、习惯、讨厌的事"],
  "communicationStyle": ["表达风格、沟通节奏"],
  "emotionalPatterns": ["反复出现的情绪模式"],
  "boundaries": ["边界、禁忌、需要避免的方式"]
}
```

`relationshipProfile` 关注用户和 AI/角色之间的关系：

```json
{
  "relationshipTone": "整体互动语气",
  "closenessLevel": "low | medium | high",
  "trustSignals": ["信任或依赖的证据"],
  "recurringTopics": ["反复出现的话题"],
  "supportNeeds": ["用户期待的支持方式"],
  "assistantRole": "AI 在关系里的角色"
}
```

`evidence` 记录来源：

```json
{
  "source": "import",
  "messageCount": 120,
  "generatedAt": "2026-06-04T..."
}
```

这里的重点不是把画像做得很花，而是让它稳定、可解释、能被 prompt 使用。

### 导入后的数据流

```text
POST /api/import/chat-records
        |
        v
解析微信聊天记录 -> createMany(messages)
        |
        +--> 用户消息写入 emotion_snapshot（jiwen）
        |
        +--> setImmediate: extractMemoriesFromImported()
        |       -> memory_chunks: fact / preference / emotion
        |
        +--> setImmediate: generateImportedSummary()
        |       -> sessions.summary
        |
        +--> setImmediate: extractProfileFromImported()
                -> sessions.import_profile
                -> sessions.profile_updated_at
                -> memory_chunks: 画像关键点
```

导入接口现在会返回：

```json
{
  "memoryExtractionQueued": true,
  "summaryQueued": true,
  "profileExtractionQueued": true
}
```

如果传入 `extractProfile: false`，就只导入消息，不自动生成画像。

### 为什么画像也同步写入 memory_chunks

画像保存在 session 里，方便整体注入 prompt；但 memory_chunks 是向量检索层，适合按当前问题召回局部相关信息。

所以这次做了双写：

- `stableFacts` -> `fact`
- `preferences` / `boundaries` / `supportNeeds` -> `preference`
- `emotionalPatterns` / `relationshipTone` -> `emotion`

这样后续用户问到相关话题时，即使完整画像没有全部展开，向量检索也能把相关片段召回。

### Prompt 接入位置

ChatService 现在的长期上下文层次是：

```text
固定人格 basePrompt
    ↓
【你们之前的对话摘要】session.summary
    ↓
【长期人格/关系画像】session.importProfile
    ↓
【关于用户的记忆】memory_chunks 检索结果
    ↓
【jiwen 情绪状态】当前用户消息即时情绪
```

这个顺序的含义：

- basePrompt 决定角色是谁。
- summary 提供中期历史。
- importProfile 提供长期人格和关系。
- memory_chunks 提供当前问题相关的局部记忆。
- jiwen 提供“此刻”的情绪状态。

### 失败兜底

画像提取是异步任务，不阻塞导入。这里有几个保护点：

- 空导入不会触发画像任务。
- LLM 返回纯 JSON 或 fenced JSON 都能解析。
- LLM 返回非法 JSON 时只打印日志，不影响 messages 写入。
- 画像最多截取有限条目，避免 prompt 被长列表撑爆。
- memory 类型不扩展 enum，避免迁移变复杂。

### 本次验证

已跑：

```text
npm run build
npm test -- --runInBand
```

新增测试覆盖：

- 微信格式导入后默认返回 `profileExtractionQueued: true`
- fenced JSON 能被解析成 `ImportProfile`

### 还可以继续学/继续做什么

1. 手动重建画像接口：例如 `POST /api/import/chat-records/:sessionId/rebuild-profile`。
2. 画像版本化：每次导入生成一个版本，避免覆盖旧画像。
3. 证据追踪：每条画像关联 source message ids，方便解释“为什么这么判断”。
4. 置信度字段：区分明确事实、强推断、弱推断。
5. 独立画像表：多用户、多角色、多会话后，把 `import_profile` 迁移到 `relationship_profiles`。
