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

| 术语             | 一句话解释                     | 类比                         |
| ---------------- | ------------------------------ | ---------------------------- |
| **HTTP**         | 浏览器和服务器通信的语言       | 寄信的协议                   |
| **API**          | 服务器对外暴露的功能接口       | 餐厅菜单：你只能点菜单上有的 |
| **路由 (Route)** | URL 路径到处理函数的映射       | `/api/chat` → 聊天处理函数   |
| **Controller**   | 接收 HTTP 请求的入口           | 餐厅服务员：接单             |
| **Service**      | 处理业务逻辑                   | 厨师：做菜                   |
| **Repository**   | 操作数据库（增删改查）         | 冰箱：存取食材               |
| **Entity**       | 数据库表对应的 JS 类           | 表格模板                     |
| **ORM**          | 把数据库行自动映射成 JS 对象   | 翻译官：SQL ↔ JS             |
| **JSON**         | 前后端通用的数据格式           | 通用信封                     |
| **.env**         | 存放密码/密钥的配置文件        | 保险箱                       |
| **Docker**       | 把软件打包成集装箱，到处可运行 | 集装箱                       |

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

| 参数                                           | 什么意思                                      | 为什么这样设                                                  |
| ---------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| `docker run`                                   | 创建并启动一个新容器                          |                                                               |
| `-d`                                           | detach，后台运行                              | 终端关了容器也不停                                            |
| `--name companion-pg`                          | 给容器起名叫 `companion-pg`                   | 后面用这个名字操作它，比如 `docker start companion-pg`        |
| `-e POSTGRES_PASSWORD=postgres`                | 环境变量：设置数据库超级用户密码              | `-e` 是 environment 缩写。容器启动时读取这些变量              |
| `-e POSTGRES_DB=companion`                     | 环境变量：自动创建一个叫 `companion` 的数据库 | 不用手动 `CREATE DATABASE`                                    |
| `-p 54321:5432`                                | 端口映射：`宿主机端口:容器内端口`             | 外部访问 54321，转发到容器内的 5432。因为本地 PG 14 已占 5432 |
| `-v companion-pgdata:/var/lib/postgresql/data` | 数据卷挂载：`卷名:容器内路径`                 | 数据存宿主机，删容器不丢数据                                  |
| `ankane/pgvector:latest`                       | 镜像名                                        | `:latest` 是最新版。包含 PostgreSQL 15 + pgvector             |

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

| 包名                | 作用                               | 为什么需要                                                 |
| ------------------- | ---------------------------------- | ---------------------------------------------------------- |
| `@nestjs/typeorm`   | NestJS 的 TypeORM 适配层           | 让 TypeORM 和 NestJS 的依赖注入系统配合工作                |
| `typeorm`           | ORM 框架本身                       | 把数据库行 ↔ JS 对象自动互转。不用手写 INSERT/ SELECT 语句 |
| `pg`                | PostgreSQL 驱动（`node-postgres`） | TypeORM 底层通过它和 PG 通信。类比：JDBC 驱动              |
| `@nestjs/config`    | 环境变量管理                       | 集中读取 `.env` 文件，密码不散落在代码各处                 |
| `@nestjs/axios`     | NestJS 封装的 HTTP 客户端          | 调用外部 API（DeepSeek、Python 服务）                      |
| `axios`             | HTTP 客户端底层库                  | `@nestjs/axios` 依赖它                                     |
| `class-validator`   | 请求参数验证                       | `@IsString()`, `@IsNotEmpty()` 等装饰器                    |
| `class-transformer` | 对象转换                           | 把纯 JSON 转成带类型的 class 实例                          |

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
  type: 'postgres', // 数据库类型
  host: process.env.DB_HOST, // 从 .env 读取
  port: parseInt(process.env.DB_PORT ?? '54321', 10), // 字符串转数字
  // ...
  autoLoadEntities: true, // 自动发现所有 Entity，不用手动列表
  synchronize: true, // 开发模式：Entity 改了自动更新表结构
  logging: true, // 控制台打印 SQL 语句（学习用）
});
```

| 配置项                   | 解释                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `autoLoadEntities: true` | 每个 Feature Module 用 `TypeOrmModule.forFeature([Entity])` 注册的 Entity 会被自动发现    |
| `synchronize: true`      | **开发专用**。改了 Entity 属性，表结构自动跟着变。生产环境必须 `false`，用 Migration 管理 |
| `logging: true`          | 每条 SQL 都打印到控制台。你可以在终端看到 `SELECT ...`, `INSERT ...` 等语句               |

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
  id: string; // 对应数据库列 id (text)

  @Column()
  name: string; // 对应数据库列 name (varchar)

  @Column({ type: 'text', name: 'base_prompt' })
  basePrompt: string; // 对应数据库列 base_prompt (text)
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

| 操作       | SQL                                   | TypeORM Repository         |
| ---------- | ------------------------------------- | -------------------------- |
| **C**reate | `INSERT INTO characters VALUES (...)` | `repo.save(entity)`        |
| **R**ead   | `SELECT * FROM characters`            | `repo.find()`              |
| **U**pdate | `UPDATE characters SET ...`           | `repo.save(entity)` ← 同上 |
| **D**elete | `DELETE FROM characters WHERE ...`    | `repo.remove(entity)`      |

NestJS 把 CRUD 拆成三层：

```
Controller（路由层：收到 HTTP 请求，调用 Service）
    │
Service（业务层：处理逻辑，调用 Repository）
    │
Repository（数据层：执行 SQL，返回结果）
```

### 创建的 Entity 清单

| Entity      | 数据库表      | 主键方式                             | 为什么这样选                                        |
| ----------- | ------------- | ------------------------------------ | --------------------------------------------------- |
| Character   | characters    | `@PrimaryColumn('text')` 手动指定    | 角色 ID 是有意义的短名（如 "xiaoya"），不用自动生成 |
| Session     | sessions      | `@PrimaryGeneratedColumn('uuid')`    | UUID 全局唯一，分布式友好                           |
| Message     | messages      | `@PrimaryGeneratedColumn()` 自增整数 | 消息量大，自增整数性能最好                          |
| MemoryChunk | memory_chunks | `@PrimaryGeneratedColumn()` 自增整数 | 同上，且 embedding 字段不映射                       |

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
    @InjectRepository(Character) // 告诉框架：我需要 Character 的 Repository
    private readonly repo: Repository<Character>, // 框架自动创建并传入
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

|        | synchronize: true             | Migration                                   |
| ------ | ----------------------------- | ------------------------------------------- |
| 怎么用 | 改 Entity → 重启 → 表自动更新 | 改 Entity → 生成 migration → 执行 migration |
| 优点   | 快速，适合早期开发            | 有版本历史，可回滚                          |
| 缺点   | 删列会丢数据，无历史          | 多一步操作                                  |
| 适用   | **现在这个阶段**              | 上线前                                      |

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

const http = require('http'); // Node.js 内置的 HTTP 模块

const SESSION_ID = '你的会话ID'; // ← 改成你的
const MESSAGE = '你好呀，今天怎么样？'; // ← 改成你想发的消息

function chat(sessionId, content) {
  // 1. 把消息内容打包成 JSON 字符串
  const postData = JSON.stringify({ content: content });

  // 2. 配置请求参数
  const options = {
    hostname: 'localhost', // 服务器地址（本机）
    port: 3000, // 服务器端口
    path: '/api/chat/' + sessionId, // API 路径
    method: 'POST', // HTTP 方法
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData), // 数据长度（必须）
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
      const result = JSON.parse(body); // JSON 字符串 → JS 对象
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

| 组件                  | 版本         | 端口  | 备注                              |
| --------------------- | ------------ | ----- | --------------------------------- |
| Node.js               | v22.22.2     | -     |                                   |
| npm                   | 10.9.7       | -     |                                   |
| NestJS CLI            | 11.x         | -     |                                   |
| TypeScript            | 5.9.3        | -     |                                   |
| TypeORM               | 1.0.0        | -     | ESM-only                          |
| Python                | 3.12.13 (uv) | -     | 通过 uv 管理                      |
| uv                    | 0.11.7       | -     | Python 包管理器                   |
| FastAPI               | 0.136.3      | 8000  | Mock 模式                         |
| PostgreSQL + pgvector | 15 (Docker)  | 54321 | 4 张表                            |
| Docker Desktop        | 29.4.0       | -     |                                   |
| NestJS + Web 前端     | -            | 3000  | API + 静态文件                    |
| Git                   | 2.41.0       | -     |                                   |
| GitHub                | -            | -     | https://github.com/L1mingyoung/ex |

### 数据库表

| 表名          | 管理方式                   | 状态          |
| ------------- | -------------------------- | ------------- |
| characters    | TypeORM Entity             | ✅            |
| sessions      | TypeORM Entity             | ✅            |
| messages      | TypeORM Entity             | ✅            |
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
      this.httpService.post(`${this.pythonUrl}/embed`, { text }),
    );
    return data.embedding; // → [0.123, -0.456, ...]  (768 numbers)
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
  imports: [EmbeddingModule], // ← 没有 TypeOrmModule！
  providers: [MemoriesService],
  exports: [MemoriesService],
})
// MemoriesService — 直接用 DataSource 写原生 SQL
@Injectable()
export class MemoriesService {
  constructor(
    private readonly db: DataSource, // ← 不注入 Repository，注入 DataSource
    private readonly embeddingService: EmbeddingService,
  ) {}

  async search(sessionId: string, queryEmbedding: number[], limit = 5) {
    return this.db.query(
      `
      SELECT id, content, memory_type,
             1 - (embedding <=> $1::vector) AS similarity
      FROM memory_chunks WHERE session_id = $2
      ORDER BY embedding <=> $1::vector LIMIT $3
    `,
      [vectorStr, sessionId, limit],
    );
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

| 参数                 | 含义               | 调大效果           |
| -------------------- | ------------------ | ------------------ |
| `m=16`               | 每个节点最大连接数 | 更精确但占更多空间 |
| `ef_construction=64` | 构建时搜索深度     | 更精确但构建更慢   |

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
if (session.messageCount < 50) return; // 消息不够 50 条
if (session.updatedAt > oneHourAgo) return; // 距离上次不够 1 小时

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

| 平台         | 接入方式    | 流式 | 难度               |
| ------------ | ----------- | ---- | ------------------ |
| Web          | fetch + SSE | ✅   | ⭐ 已完成          |
| 微信小程序   | wx.request  | ❌   | ⭐⭐ 已有适配器    |
| uni-app      | uni.request | ❌   | ⭐⭐ 已有适配器    |
| React Native | fetch       | ✅   | ⭐ 可直接用 api.js |
| QQ Bot       | WebSocket + HTTP | ❌   | ⭐⭐⭐ 需 SDK + 公网服务器 |
| Telegram Bot | Webhook          | ❌   | ⭐ 简单 HTTP              |

> **QQ Bot 公网部署说明：** 虽然开发阶段可以通过 WebSocket 客户端模式（`index.js`）在本地连接 QQ 网关进行调试，但正式上线必须部署到公网服务器：
> - QQ 开放平台审核要求提供公网可访问的服务地址
> - 群聊消息等部分事件需要 QQ 服务器主动回调（Webhook 模式）
> - 生产环境 Bot 需要 24/7 稳定运行，不适合依赖个人开发机
>
> 实际部署时，`index.js` 中的 `API_BASE` 需改为公网 NestJS 地址，而非 `http://localhost:3000`。

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

## 2026-06-05 | AI 情绪模型增强

### MoodService — AI 也有情绪了

`src/emotion/mood.service.ts`：每个会话维护 AI 自身情绪状态。

- **共鸣**：AI 情绪受用户影响，向用户靠拢一小步
- **衰减**：逐步回归中性
- **随机**：±3% 微小波动
- **二维模型**：valence × arousal → 8 种标签
- **注入 prompt**：告诉 AI"你现在感觉如何，该用什么语气"

### jiwen 策略增强

每种用户情绪有了具体中文回应指导（不只一句"接住情绪"）。

### 角色设定 merge/replace 双模式

导入聊天记录可选择合并或替换角色人设。

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


## 2026-06-06 学习笔记：Docker 部署架构

这次把项目从“本机分别启动服务”整理成 Docker Compose 三服务架构：

```text
浏览器
  ↓
api: NestJS + web/dist
  ↓
postgres: PostgreSQL + pgvector
  ↓
embedding: Python FastAPI + ONNX Runtime
```

关键点：

- API 容器里不能再访问 `localhost:54321` 或 `localhost:8000`，因为容器内的 localhost 是自己；Compose 内部要用服务名：`postgres:5432` 和 `http://embedding:8000`。
- pgvector 用官方 `pgvector/pgvector:pg16` 镜像，避免自己在 PostgreSQL 镜像里编译扩展。
- ONNX 模型很大，不适合 bake 进镜像；现在通过 `./python/models:/app/models:ro` 挂载给 embedding 容器。
- API 镜像采用多阶段构建：先安装依赖和构建前端/后端，最终 runtime 只保留 production 依赖、`dist` 和 `web/dist`。
- TypeORM migration 仍然在 API 启动时自动执行，所以容器启动顺序需要等 Postgres healthcheck 通过。

本次验证：

```text
docker compose --env-file .env.docker.example -f docker-compose.yml config
```

配置可解析；实际首次 `up --build` 会下载 Node/Python/pgvector 镜像和 npm/uv 依赖，需要 Docker 网络可用。

## 2026-06-08 学习笔记：Docker 改造后如何运行和部署

### 这次添加 Docker 后，项目发生了什么变化

原来项目是“本机分别启动多个服务”：

```text
本机 PostgreSQL / Docker Postgres
本机 Python embedding 服务
本机 NestJS 后端
本机 Vite 前端
```

现在改造成 Docker Compose 三服务架构：

```text
浏览器
  ↓
api 容器：NestJS 后端 + web/dist 静态前端
  ↓
postgres 容器：PostgreSQL + pgvector
  ↓
embedding 容器：Python FastAPI + ONNX Runtime
```

新增文件：

```text
Dockerfile                    # 构建 NestJS API，并同时构建 web 前端
python/Dockerfile             # 构建 Python embedding 服务
docker-compose.yml            # 一键编排 api / embedding / postgres
.env.docker.example           # Docker 部署专用环境变量模板
.dockerignore                 # 避免 node_modules、dist、ONNX 大模型进入 API 镜像
python/.dockerignore          # 避免 Python 虚拟环境和模型进入 embedding 镜像
docs/Docker_Deployment.md     # Docker 部署说明
```

关键变化：

- API 容器不再连接 `localhost:54321`，而是连接 `postgres:5432`。
- API 容器不再连接 `localhost:8000`，而是连接 `http://embedding:8000`。
- 前端不需要单独启动 Vite；生产环境由 NestJS 直接服务 `web/dist`。
- Postgres 使用 `pgvector/pgvector:pg16` 镜像，自动带 pgvector 扩展。
- Python embedding 服务单独成容器，ONNX 模型通过 volume 挂载，不打进镜像。
- TypeORM migration 仍然由 API 启动时自动执行。

### 本地 Docker 运行方式

进入项目目录：

```powershell
cd D:\Code\ex
```

复制 Docker 环境变量模板：

```powershell
copy .env.docker.example .env.docker
```

编辑 `.env.docker`，至少修改：

```text
DB_PASSWORD=你的数据库密码
DEEPSEEK_API_KEY=你的 DeepSeek API Key
```

确认真实 embedding 模型存在：

```text
D:\Code\ex\python\models\jina-embeddings-v2-base-zh.onnx
D:\Code\ex\python\models\tokenizer.json
```

启动：

```powershell
docker compose --env-file .env.docker up --build
```

启动后访问：

```text
http://localhost:3000
```

常用命令：

```powershell
# 查看容器
docker compose --env-file .env.docker ps

# 查看全部日志
docker compose --env-file .env.docker logs -f

# 只看 API 日志
docker compose --env-file .env.docker logs -f api

# 只看 embedding 日志
docker compose --env-file .env.docker logs -f embedding

# 停止，但保留数据库数据
docker compose --env-file .env.docker down

# 停止，并删除数据库 volume，危险：会清空数据库
docker compose --env-file .env.docker down -v
```

如果只是想测试 Docker 全链路，但模型还没准备好，可以临时在 `.env.docker` 里设置：

```text
MOCK_EMBEDDING=1
```

注意：mock embedding 只能测试服务能不能跑通，不适合真实长期记忆检索。

### 为什么 Docker 里不能继续用 localhost

初学 Docker 最容易踩的坑：容器里的 `localhost` 指的是“容器自己”，不是宿主机，也不是其他容器。

所以本机开发时可以这样：

```text
DB_HOST=localhost
PYTHON_EMBED_URL=http://localhost:8000
```

但 Docker Compose 里必须这样：

```text
DB_HOST=postgres
PYTHON_EMBED_URL=http://embedding:8000
```

`postgres` 和 `embedding` 是 `docker-compose.yml` 里的服务名。Compose 会自动创建内部网络，让服务名变成可访问的主机名。

### 部署到云服务器的推荐流程

服务器推荐使用：

```text
Ubuntu 22.04 + Docker
```

如果购买时选择了 `Ubuntu22.04-Docker26` 镜像，通常 Docker 已经装好。登录服务器后先检查：

```bash
docker --version
docker compose version
```

如果没有 Docker，再安装 Docker；如果已经有，就不用重复安装。

### 第一次部署到服务器

1. 登录服务器：

```bash
ssh root@你的服务器公网IP
```

2. 安装 Git（如果没有）：

```bash
apt update
apt install -y git
```

3. 拉取项目：

```bash
git clone 你的仓库地址 companion
cd companion
```

如果你暂时没有推 GitHub，也可以用 SFTP / scp / 文件上传等方式把 `D:\Code\ex` 上传到服务器。

4. 准备环境变量：

```bash
cp .env.docker.example .env.docker
nano .env.docker
```

至少修改：

```text
DB_PASSWORD=强密码
DEEPSEEK_API_KEY=你的真实 key
MOCK_EMBEDDING=0
```

5. 准备 embedding 模型：

服务器上需要有：

```text
python/models/jina-embeddings-v2-base-zh.onnx
python/models/tokenizer.json
```

如果模型文件已经在本机，可以上传：

```bash
scp python/models/jina-embeddings-v2-base-zh.onnx root@服务器IP:/root/companion/python/models/
scp python/models/tokenizer.json root@服务器IP:/root/companion/python/models/
```

如果暂时不上传模型，可以先把 `.env.docker` 改成：

```text
MOCK_EMBEDDING=1
```

6. 启动：

```bash
docker compose --env-file .env.docker up --build -d
```

7. 查看状态：

```bash
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs -f api
```

8. 浏览器访问：

```text
http://服务器公网IP:3000
```

如果访问不了，检查云服务器安全组是否放行 TCP 3000 端口。

### 生产部署下一步：域名和 HTTPS

第一阶段可以直接用：

```text
http://服务器公网IP:3000
```

但正式使用建议：

```text
域名 -> Nginx/Caddy -> api:3000
HTTPS 自动证书
```

后续可以加一个反向代理服务，例如 Caddy：

```text
Caddy 监听 80/443
  ↓
反向代理到 api:3000
```

这样用户访问 `https://你的域名`，而不是暴露 `http://服务器IP:3000`。

### 服务器上更新项目

以后代码更新后，服务器上执行：

```bash
cd companion
git pull
docker compose --env-file .env.docker up --build -d
```

如果只想重启：

```bash
docker compose --env-file .env.docker restart
```

### 当前 Docker 部署的边界

已经完成：

- API / Web / Embedding / Postgres 编排
- pgvector 数据库镜像
- embedding 模型 volume 挂载
- Docker 专用 env 模板
- 基础部署文档

还没做：

- Nginx / Caddy HTTPS 反向代理
- 自动备份 PostgreSQL
- 日志轮转和监控
- CI/CD 自动部署
- 多环境配置，如 dev / staging / prod

当前阶段先把 `docker compose up --build -d` 跑通，再考虑 HTTPS、备份和监控。


## 2026-06-08 学习笔记：把踩坑固化成规则和 Skill

这次新增了两层防呆机制：

- 项目内规则文档：`docs/Project_Rules.md`
- Codex skill：`C:\Users\Lianyue\.codex\skills\ai-companion-project-guardrails`

这样以后继续做 Docker、部署、微信导入、长期记忆、文档同步时，不只靠临场回忆，而是优先按规则检查。

重点规则：

- Docker 容器之间不用 `localhost`，用服务名：`postgres`、`embedding`。
- ONNX 大模型用 volume 挂载，不打进镜像。
- 改完重要功能要同步 `Implementation_Plan.md` 和 `Learning_Notes.md`。
- Windows 终端中文乱码不等于源码坏了，不要乱修注释。
- 微信记录导出走安全剪贴板工具，不碰数据库解密。
- 云服务购买先按当前需求，不买暂时用不到的配套项。

---

## 2026-06-09 | 前端移动端适配学习笔记

### 一、为什么不用跨端框架？

| 框架 | H5 输出 | 小程序输出 | 原生 App | 适合场景 |
|------|---------|-----------|---------|---------|
| **React + CSS 响应式** | ✅ 原生 | ❌ | ❌ | 只需要 H5 |
| **Taro** | ✅ 编译输出 | ✅ 编译输出 | ❌ | H5 + 小程序 |
| **React Native + RN Web** | ✅ 映射 | ❌ | ✅ | App + H5 |
| **Uni-app** | ✅ 编译输出 | ✅ 编译输出 | ✅ | 全平台（Vue） |

**结论**：只需要 H5 移动端兼容时，纯 CSS 响应式是最轻量、最高效的方案。跨端框架引入的额外复杂度（组件体系替换、CSS 限制、路由替换、构建工具切换）远大于收益。

### 二、视口（Viewport）基础

#### 什么是视口？

视口是浏览器用来渲染页面的区域。移动端浏览器的视口行为和桌面完全不同：

```
桌面浏览器：视口 = 浏览器窗口大小
移动浏览器：视口 ≠ 屏幕宽度（默认会模拟 980px 宽度）
```

#### viewport meta 标签

```html
<meta name="viewport"
  content="width=device-width,        ← 视口宽度 = 设备宽度（不再模拟 980px）
           initial-scale=1.0,          ← 初始缩放比例 1:1
           maximum-scale=1.0,          ← 禁止放大（聊天应用不需要）
           user-scalable=no,           ← 禁止用户手动缩放
           viewport-fit=cover"         ← 内容延伸到安全区域外（刘海屏）
/>
```

| 参数 | 作用 | 为什么这样设 |
|------|------|-------------|
| `width=device-width` | 视口宽度等于设备物理宽度 | 不设的话移动端会以 980px 渲染再缩放，文字模糊 |
| `initial-scale=1.0` | 页面初始缩放 1:1 | 配合 `width=device-width` 实现像素级清晰 |
| `maximum-scale=1.0` + `user-scalable=no` | 禁止缩放 | 聊天应用不需要缩放，防止误触放大 |
| `viewport-fit=cover` | 内容覆盖到安全区域 | 让背景色延伸到刘海/圆角区域，不会出现白边 |

#### iOS PWA 支持

```html
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="theme-color" content="#0d0c0e" />
```

| 标签 | 作用 |
|------|------|
| `apple-mobile-web-app-capable` | 允许添加到主屏幕后全屏运行（隐藏 Safari 地址栏） |
| `apple-mobile-web-app-status-bar-style` | 状态栏样式：`black-translucent` 让状态栏透明，内容延伸到顶部 |
| `theme-color` | 浏览器 UI 元素颜色（地址栏底色），匹配页面背景色避免闪烁 |

### 三、安全区域（Safe Area）

#### 什么是安全区域？

iPhone X 开始有刘海（notch）和底部 Home Indicator。这些区域不能放交互内容：

```
┌─────────────────────────────┐
│         刘海区域             │ ← safe-area-inset-top
│  ┌───────────────────────┐  │
│  │                       │  │
│  │     可用内容区域       │  │
│  │                       │  │
│  └───────────────────────┘  │
│         Home Indicator       │ ← safe-area-inset-bottom
└─────────────────────────────┘
```

#### CSS env() 函数

```css
:root {
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
}
```

- `env(safe-area-inset-top, 0px)`：读取系统安全区域值，不支持时回退到 `0px`
- 必须配合 `viewport-fit=cover` 使用，否则 `env()` 返回 0
- 定义为 CSS 变量后，全局可用，不用每个地方都写 `env()`

#### 使用方式

```css
/* 输入区底部要避开 Home Indicator */
#input-area {
  padding-bottom: calc(10px + var(--safe-bottom));
}

/* 侧边栏顶部要避开刘海 */
#sidebar {
  padding-top: calc(20px + var(--safe-top));
}
```

### 四、动态视口高度（dvh）

#### 问题：100vh 在移动端的 bug

```
桌面端：100vh = 视口高度 ✅

iOS Safari：100vh = 包含地址栏的高度 ❌
  → 地址栏隐藏后，内容比实际视口高
  → 底部内容被截断

Android Chrome：100vh = 不包含地址栏的高度
  → 地址栏显示时，内容比视口矮
  → 底部出现空白
```

#### 解决方案：dvh 单位

```css
body {
  height: 100vh;      /* 回退：不支持 dvh 的浏览器 */
  height: 100dvh;     /* 动态视口高度：跟随地址栏变化 */
}
```

| 单位 | 含义 | 地址栏显示时 | 地址栏隐藏时 |
|------|------|-------------|-------------|
| `vh` | 视口高度（固定） | 偏大（iOS） | 正确 |
| `svh` | 小视口高度 | 地址栏隐藏时的高度 | 同左 |
| `lvh` | 大视口高度 | 地址栏显示时的高度 | 同左 |
| `dvh` | 动态视口高度 | 自动调整 | 自动调整 |

**`100dvh` 会随地址栏显示/隐藏自动变化**，是目前最完美的方案。

### 五、抽屉式侧边栏

#### 桌面端 vs 移动端的布局差异

```
桌面端（≥769px）：
┌──────────┬──────────────────────┐
│          │                      │
│ 侧边栏    │     聊天区域          │
│ 300px    │     flex: 1          │
│          │                      │
└──────────┴──────────────────────┘

移动端（≤768px）：
┌──────────────────────┐
│ ☰  聊天区域标题       │ ← 汉堡菜单
│                      │
│     聊天内容          │ ← 全屏
│                      │
│  [输入框] [发送]      │
└──────────────────────┘

点击汉堡菜单后：
┌─────┬─────────────────┐
│侧边 │  ████ 遮罩 ████  │ ← 半透明遮罩
│栏   │                  │
│85vw │                  │
│     │                  │
└─────┴─────────────────┘
```

#### 实现原理

```css
/* 桌面端：正常 flex 布局 */
#sidebar {
  width: 300px;
  min-width: 300px;
}

/* 移动端：固定定位 + 滑出动画 */
@media (max-width: 768px) {
  #sidebar {
    position: fixed;           /* 脱离文档流，覆盖在聊天区上方 */
    top: 0; left: 0; bottom: 0;
    width: 85vw;               /* 占屏幕 85%，最大 360px */
    max-width: 360px;
    transform: translateX(-100%);  /* 默认滑出屏幕外 */
    transition: transform 250ms cubic-bezier(0.16, 1, 0.3, 1);
    z-index: 100;              /* 在遮罩之上 */
  }

  /* 打开状态 */
  .sidebar-open #sidebar {
    transform: translateX(0);  /* 滑入屏幕 */
    box-shadow: 8px 0 40px rgba(0, 0, 0, 0.4);  /* 加阴影增加层次感 */
  }
}
```

#### 遮罩层

```tsx
{/* App.tsx */}
<div className="sidebar-overlay" onClick={closeSidebar} />
```

```css
.sidebar-overlay {
  display: none;           /* 桌面端不显示 */
  position: fixed;
  inset: 0;                /* top/right/bottom/left 全 0 */
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(6px);  /* 毛玻璃效果 */
  z-index: 90;             /* 在侧边栏之下 */
}

.sidebar-open .sidebar-overlay {
  display: block;
  opacity: 1;
}
```

#### 状态管理

```tsx
// App.tsx
const [sidebarOpen, setSidebarOpen] = useState(false);

// 选择会话后自动关闭侧边栏
const handleSelectSession = (id: string) => {
  selectSession(id);
  setSidebarOpen(false);    // ← 关键：选择即关闭
};

// 通过 className 控制全局状态
<div className={`app ${sidebarOpen ? 'sidebar-open' : ''}`}>
```

### 六、iOS 输入框缩放问题

#### 问题

iOS Safari 对 `font-size < 16px` 的输入框会自动缩放页面，导致布局错乱：

```
输入框 font-size: 14px → iOS 自动放大到 16px → 页面被缩放 → 布局崩溃
```

#### 解决方案

```css
@media (max-width: 768px) {
  #message-input {
    font-size: 16px;   /* ≥16px iOS 不会自动缩放 */
  }
}
```

这是最简单有效的方案。其他方案（如 `maximum-scale=1`）会影响可访问性。

### 七、输入框自适应高度

#### 原理

HTML `<textarea>` 默认固定高度。要实现"内容少时一行，内容多时自动变高"：

```tsx
// InputArea.tsx
const textareaRef = useRef<HTMLTextAreaElement>(null);

// 每次文字变化时重新计算高度
useEffect(() => {
  const el = textareaRef.current;
  if (!el) return;
  el.style.height = 'auto';                          // 先重置为 auto
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';  // 再设为内容高度，上限 120px
}, [text]);
```

**为什么要先设 `auto` 再设 `scrollHeight`？**

因为 `scrollHeight` 是"内容需要的最小高度"。但如果 `height` 已经大于内容高度，`scrollHeight` 会返回当前 `height` 而不是内容高度。先 `auto` 重置，`scrollHeight` 才会返回真实内容高度。

### 八、触摸交互优化

#### 1. 最小触摸目标

Apple HIG 规定最小触摸目标 44×44pt：

```css
@media (max-width: 768px) {
  .modal-actions button {
    min-height: 44px;   /* Apple HIG 最小触摸目标 */
  }
}
```

#### 2. 移动端无 hover 的处理

桌面端 hover 显示操作按钮，移动端没有 hover：

```css
/* 桌面端：hover 才显示 */
.char-edit-btn {
  opacity: 0;
}
.character-item:hover .char-edit-btn {
  opacity: 1;
}

/* 移动端：常显半透明 */
@media (max-width: 768px) {
  .char-edit-btn {
    opacity: 0.5;    /* 没有hover，始终半透明可见 */
  }
}
```

#### 3. 按压反馈

移动端没有 hover，用 `:active` 伪类提供触摸反馈：

```css
.menu-btn:active {
  transform: scale(0.92);   /* 按下时缩小 8% */
}

#send-btn:active {
  transform: scale(0.97);   /* 按下时缩小 3% */
}
```

#### 4. 禁止默认触摸行为

```css
html, body {
  -webkit-tap-highlight-color: transparent;  /* 禁止点击高亮（Android 蓝色闪烁） */
  overscroll-behavior: none;                 /* 禁止过度滚动（下拉刷新/橡皮筋效果） */
}
```

### 九、CSS 变量设计系统

#### 为什么用 CSS 变量？

```css
/* ❌ 硬编码：改主题要改几十个地方 */
.button { background: #6366f1; }
.link { color: #6366f1; }
.border { border-color: rgba(99, 102, 241, 0.3); }

/* ✅ CSS 变量：改一处全局生效 */
:root { --accent: #d4764e; }
.button { background: var(--accent); }
.link { color: var(--accent); }
.border { border-color: var(--accent-soft); }
```

#### 本项目的变量体系

```css
:root {
  /* 背景层级：4 级递增亮度 */
  --bg: #0d0c0e;           /* 最深：页面底色 */
  --bg-surface: #161518;   /* 侧边栏、卡片 */
  --bg-elevated: #1e1c21;  /* 输入框、弹出层 */
  --bg-hover: #252329;     /* hover 状态 */

  /* 前景层级：3 级递减重要性 */
  --fg: #e8e2d9;           /* 正文 */
  --fg-secondary: #a09a92; /* 次要文字 */
  --fg-muted: #6b665f;     /* 占位符、标签 */

  /* 主色调 + 衍生色 */
  --accent: #d4764e;              /* 主色 */
  --accent-soft: rgba(212,118,78,0.12);  /* 淡底色（选中态） */
  --accent-hover: #e08a64;        /* hover 态 */
  --accent-glow: rgba(212,118,78,0.25);  /* 发光（阴影） */

  /* 圆角体系 */
  --radius-sm: 8px;    /* 小元素：按钮、输入框 */
  --radius: 14px;      /* 中元素：消息气泡 */
  --radius-lg: 20px;   /* 大元素：模态框 */
  --radius-full: 9999px; /* 胶囊：标签、徽章 */

  /* 动画曲线 */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);     /* 减速：滑入 */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* 弹性：弹出 */
}
```

### 十、媒体查询断点策略

```css
/* 移动端优先的断点设计 */

/* 默认样式 = 桌面端 */
#sidebar { width: 300px; }

/* 移动端覆盖 */
@media (max-width: 768px) {
  #sidebar { position: fixed; ... }
}
```

| 断点 | 含义 | 典型设备 |
|------|------|---------|
| ≤768px | 移动端 | 手机竖屏 |
| 769px+ | 桌面端 | 平板横屏、笔记本、台式 |

**为什么选 768px？** iPad 竖屏 768px，是"手机"和"平板"的自然分界线。768px 以下用抽屉式导航，以上用固定侧边栏。

### 十一、backdrop-filter 毛玻璃效果

```css
#chat-header {
  background: rgba(13, 12, 14, 0.8);   /* 半透明底色 */
  backdrop-filter: blur(16px);          /* 背后内容模糊 16px */
  -webkit-backdrop-filter: blur(16px);  /* Safari 前缀 */
}
```

- `backdrop-filter: blur()` 让元素背后的内容变模糊，产生毛玻璃效果
- 必须配合半透明 `background` 使用（不透明就看不到背后了）
- `-webkit-` 前缀：Safari 仍需要前缀
- 性能注意：大面积 blur 在低端设备可能卡顿，本项目只在 header/footer 使用

---

## 2026-06-09 | H5 完善：交互增强与样式补全

### 技术要点

#### 1. AbortController 取消 SSE 流式请求

SSE（Server-Sent Events）流式请求一旦发起，会持续接收数据直到服务端关闭。用户可能不想等 AI 回复完，需要"停止生成"功能。

**实现方式：**

```typescript
// 发起请求时保存 AbortController
const controller = new AbortController();
fetch(url, { signal: controller.signal });

// 用户点击"停止"时
controller.abort();  // 取消 fetch，触发 AbortError
```

**关键细节：**

- `abort()` 后 fetch 会抛出 `AbortError`，需要在 `.catch()` 中判断 `err.name !== 'AbortError'` 才报告错误
- 中断后需要清理状态：如果 AI 回复为空则移除气泡，否则保留已有内容
- `AbortController` 只能使用一次，abort 后需要创建新的实例

#### 2. 消息时间戳的 hover 显示

聊天应用中时间戳是重要信息，但常驻显示会干扰阅读。解决方案：

- 时间戳默认 `opacity: 0`，hover 时 `opacity: 1`
- 使用 `transition` 实现平滑淡入
- 移动端无 hover，可考虑始终显示（后续优化）

```css
.message-time {
  opacity: 0;
  transition: opacity 150ms;
}
.message:hover .message-time {
  opacity: 1;
}
```

#### 3. Toast 通知组件设计

替代 `alert()` 的非阻塞通知方案：

| 对比 | alert() | Toast |
|------|---------|-------|
| 阻塞 | 阻塞主线程 | 非阻塞 |
| 定位 | 浏览器原生弹窗 | 固定定位右上角 |
| 样式 | 不可自定义 | 完全自定义 |
| 多条 | 一次只能一个 | 可堆叠显示 |
| 自动消失 | 需手动关闭 | 3 秒自动消失 |

**实现要点：**

- 使用 `createContext` + `useCallback` 全局共享 toast 函数
- `useRef` 计数器生成唯一 ID，避免 `useState` 的闭包陷阱
- `setTimeout` 3 秒后自动移除
- CSS `pointer-events: none` 让容器不阻挡点击，但单个 toast `pointer-events: auto` 允许交互

#### 4. 消息气泡 flex 布局重构

旧布局：消息内容直接在 `.message` div 内，AI 头像无法与气泡对齐。

新布局：

```
.message (flex row)
  ├── .message-avatar (AI only, flex-shrink: 0)
  │   └── .avatar-ai
  └── .message-body (flex: 1, min-width: 0)
      ├── .message-content
      └── .message-meta
          ├── .message-time
          └── .typing-dots
```

用户消息使用 `flex-direction: row-reverse` 让内容靠右。

### 踩坑记录

- **Toast 组件缺少 CSS**：之前创建了 Toast 组件但忘记写样式，导致通知不可见。现在在 `index.css` 中补全了 `.toast-container` 和三种类型的样式。
- **empty-hint 无样式**：`CharacterSection` 和 `SessionSection` 使用了 `.empty-hint` 类但没有对应 CSS，文字直接贴边。现在补全了居中灰色小字样式。
- **停止按钮的 border 重复声明**：`#stop-btn` 同时写了 `border: none` 和 `border: 1px solid ...`，后者覆盖前者。应只保留需要的那个。

### 设计决策

- **时间戳 hover 显示 vs 始终显示**：选择 hover 显示，因为聊天界面信息密度高，时间戳常驻会干扰阅读。移动端后续可改为始终显示。
- **停止按钮红色风格**：与发送按钮的珊瑚色形成对比，红色传达"中断/危险"语义，用户一眼能区分。
- **空 AI 回复移除 vs 保留**：如果用户在 AI 还没输出任何内容时就停止，移除空气泡更干净；如果已有部分内容，保留并标记为完成。
- **Toast 位置右上角**：符合主流应用习惯（如 macOS 通知、Discord 等），不遮挡聊天输入区。

---

## 2026-06-09 | 亮色/暗色主题切换

### 技术要点

#### 1. CSS 变量 + data 属性实现主题切换

最主流的主题切换方案：在 `:root` 定义暗色变量，在 `[data-theme="light"]` 覆盖为亮色值。切换主题只需修改 `document.documentElement` 的 `data-theme` 属性，所有 CSS 变量自动生效。

```css
:root {
  --bg: #0d0c0e;          /* 暗色背景 */
  --fg: #e8e2d9;          /* 暗色前景 */
  color-scheme: dark;     /* 告诉浏览器用暗色原生控件 */
}

[data-theme="light"] {
  --bg: #f7f3ee;          /* 亮色背景 */
  --fg: #1a1714;          /* 亮色前景 */
  color-scheme: light;    /* 告诉浏览器用亮色原生控件 */
}
```

**为什么用 CSS 变量而不是两套 CSS 文件？**

- 单文件维护，改一个变量全局生效
- 运行时切换无需重新加载样式表
- 语义化命名（`--bg`、`--fg`）比 `.dark-theme .xxx` 更清晰

#### 2. FOUC（Flash of Unstyled Content）防闪烁

如果主题切换在 React 渲染后才执行，用户会先看到暗色再闪到亮色。解决方案：在 `index.html` 的 `<head>` 中用内联脚本在页面渲染前就读取 localStorage 并设置 `data-theme`。

```html
<script>
  (function(){
    try {
      var t = localStorage.getItem('companion-theme');
      if (t === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
        document.querySelector('meta[name="theme-color"]').content = '#f7f3ee';
      }
    } catch(e){}
  })();
</script>
```

**关键：** 这个脚本必须在 `<head>` 中、CSS 加载之前执行，才能确保首次渲染就是正确的主题。

#### 3. 系统偏好检测

使用 `window.matchMedia('(prefers-color-scheme: light)')` 检测用户操作系统级别的主题偏好。如果用户没有手动选择过主题，就跟随系统设置。

```typescript
function getInitialTheme(): Theme {
  const stored = localStorage.getItem('companion-theme');
  if (stored === 'light' || stored === 'dark') return stored;
  // 没有存储过，跟随系统
  if (window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}
```

#### 4. 亮色主题的语义色适配

暗色主题中，错误/成功/警告等语义色使用半透明背景 + 亮色文字（如 `rgba(239, 68, 68, 0.12)` + `#f87171`）。但在亮色主题中，这些颜色对比度不够，需要使用更深的实色：

| 语义 | 暗色 | 亮色 |
|------|------|------|
| 错误文字 | `#f87171`（亮红） | `#dc2626`（深红） |
| 错误背景 | `rgba(239,68,68,0.12)` | `rgba(220,38,38,0.06)` |
| 成功文字 | `#4ade80`（亮绿） | `#16a34a`（深绿） |
| 警告文字 | `#fbbf24`（亮黄） | `#a16207`（深黄） |

**原理：** 暗色背景上需要亮色文字才清晰，亮色背景上需要深色文字才清晰。同样的 `#f87171` 在白色背景上对比度不足（WCAG 不达标）。

#### 5. theme-color Meta 标签联动

`<meta name="theme-color">` 控制移动端浏览器地址栏颜色。切换主题时需要同步更新：

```typescript
function updateMetaThemeColor(t: Theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', META_THEME_COLORS[t]);
}
```

暗色 `#0d0c0e` → 亮色 `#f7f3ee`，让浏览器 UI 与应用主题一致。

#### 6. 新增 CSS 变量提取硬编码颜色

原来 header 和 input area 的背景直接写 `rgba(13, 12, 14, 0.8)`，这在亮色主题下不对。提取为 CSS 变量：

```css
:root {
  --bar-bg: rgba(13, 12, 14, 0.8);      /* 暗色半透明 */
  --overlay-bg: rgba(0, 0, 0, 0.6);     /* 暗色遮罩 */
  --sidebar-shadow: 8px 0 40px rgba(0, 0, 0, 0.4);
}

[data-theme="light"] {
  --bar-bg: rgba(247, 243, 238, 0.85);  /* 亮色半透明 */
  --overlay-bg: rgba(0, 0, 0, 0.3);     /* 亮色遮罩（更轻） */
  --sidebar-shadow: 8px 0 40px rgba(0, 0, 0, 0.1);
}
```

### 踩坑记录

- **硬编码颜色是主题切换的天敌**：任何直接写的 `rgba(13, 12, 14, ...)` 或 `rgba(0, 0, 0, ...)` 在亮色主题下都会暴露问题。必须全部提取为 CSS 变量。
- **亮色主题下毛玻璃效果需要不同底色**：`backdrop-filter: blur()` 的效果取决于底层颜色，暗色用 `rgba(13,12,14,0.8)` 亮色用 `rgba(247,243,238,0.85)` 才能保持一致的模糊质感。

### 设计决策

- **暖白而非冷白**：亮色主题背景用 `#f7f3ee`（暖白）而非 `#ffffff`（纯白），保持与暗色主题一致的温暖调性。珊瑚色 accent 在暖白上同样和谐。
- **默认暗色**：聊天类应用暗色更舒适（尤其是夜间），且项目原本就是暗色设计。亮色作为可选切换。
- **SVG 图标而非 emoji**：太阳/月亮使用内联 SVG，避免 emoji 在不同平台渲染不一致，且颜色跟随 `currentColor` 自动适配主题。
- **切换按钮放在 ChatHeader**：Header 是始终可见的区域，切换操作频率低，不需要放在侧边栏。

---

## 2026-06-09 | 补充：移动端适配与主题切换进阶知识

> 以下内容面向没有移动端适配和主题切换经验的开发者，详细解释每个概念背后的原理。

### 一、color-scheme 属性详解

#### 它做了什么？

```css
:root {
  color-scheme: dark;    /* 告诉浏览器：这个页面是暗色的 */
}

[data-theme="light"] {
  color-scheme: light;   /* 告诉浏览器：这个页面是亮色的 */
}
```

`color-scheme` 影响浏览器原生控件的渲染风格：

| 原生控件 | dark 模式 | light 模式 |
|---------|----------|-----------|
| 滚动条 | 深色轨道 + 浅色滑块 | 浅色轨道 + 深色滑块 |
| `<input>` 默认样式 | 深色背景 | 浅色背景 |
| `<select>` 下拉 | 深色面板 | 浅色面板 |
| 表单自动填充 | 深色背景 | 浅色背景 |
| 系统对话框 | 暗色风格 | 亮色风格 |

**如果不设置**：浏览器不知道页面是亮是暗，可能用系统默认的控件风格，导致暗色页面上出现亮色滚动条或表单控件。

#### 与 meta 标签的区别

```html
<meta name="color-scheme" content="dark light" />
```

`<meta>` 标签在 HTML 解析时就生效（比 CSS 更早），但只能声明支持哪些方案。CSS 的 `color-scheme` 属性可以精确控制当前元素及其子元素的配色方案。

### 二、user-select: none 的继承行为

#### 问题场景

用户反馈：输入框外层 div 可以被选中（出现蓝色选中状态），体验不好。

```
┌── #input-area (div) ──────────────────────┐
│  ┌── textarea ──────┐  ┌── button ────┐   │  ← 点击 div 空白处会出现选中蓝框
│  │ 输入消息...       │  │    发送      │   │
│  └──────────────────┘  └──────────────┘   │
└───────────────────────────────────────────┘
```

#### 解决方案

```css
#input-area {
  user-select: none;         /* 外层 div 不可选中 */
  -webkit-user-select: none; /* Safari 兼容 */
}
```

#### 关键知识：textarea 不受影响

`user-select: none` 设置在父元素上，但 **textarea 内部仍然可以选中文字**。原因：

1. **表单元素有默认的 `user-select` 值**：`<input>`、`<textarea>`、`contenteditable` 元素的浏览器默认 `user-select` 是 `contain`（允许在元素内部选中），不是 `inherit`
2. **`none` 不覆盖表单元素的默认值**：因为 CSS 继承优先级低于元素默认样式，表单元素会保持自己的默认行为
3. **如果需要让 textarea 也不可选中**：需要显式设置 `textarea { user-select: none; }`

```
继承链：
#input-area (user-select: none)
  └── textarea (user-select: contain ← 浏览器默认，不继承 none)
  └── button (user-select: none ← 继承自父元素)
```

#### 其他需要 user-select: none 的场景

| 场景 | 原因 |
|------|------|
| 欢迎页面文字 | 纯展示内容，选中无意义，误触选中影响体验 |
| 按钮文字 | 点击按钮时不应选中文字 |
| 图标/Logo | 选中后出现蓝色高亮，破坏视觉 |
| 侧边栏导航项 | 点击导航不应选中文字 |
| 消息时间戳 | hover 才显示的小文字，选中无意义 |

### 三、亮色主题色板选择的完整思路

#### 从暗色到亮色的转换规则

不是简单地把颜色取反，而是遵循以下规则：

**规则 1：背景层级方向反转**

```
暗色：越"高"的层级越亮（从底部往上）
  --bg:         #0d0c0e  ← 最深（页面底色）
  --bg-surface: #161518  ← 侧边栏
  --bg-elevated:#1e1c21  ← 卡片/输入框
  --bg-hover:   #252329  ← hover 态

亮色：越"高"的层级越亮（从底部往上，但整体偏白）
  --bg:         #f7f3ee  ← 最暗的亮色（页面底色，暖白）
  --bg-surface: #ffffff  ← 纯白（侧边栏，最亮）
  --bg-elevated:#f0ebe4  ← 略暗于白（卡片/输入框）
  --bg-hover:   #e8e2d9  ← hover 态（更暗一点）
```

注意亮色中 `--bg-surface` 是纯白 `#ffffff`（侧边栏），而 `--bg` 是暖白 `#f7f3ee`（主背景）。这是因为侧边栏在亮色主题中应该是"白纸"效果，而主聊天区用暖白营造温暖氛围。

**规则 2：前景色对比度必须达标**

WCAG 2.1 AA 标准要求：正文文字与背景的对比度 ≥ 4.5:1。

```
暗色主题：
  背景 #0d0c0e + 文字 #e8e2d9 → 对比度 ~14:1 ✅

亮色主题：
  背景 #f7f3ee + 文字 #1a1714 → 对比度 ~15:1 ✅
  背景 #f7f3ee + 次要文字 #5c5650 → 对比度 ~6:1 ✅
  背景 #f7f3ee + 弱化文字 #8a847e → 对比度 ~3.5:1 ⚠️ (仅用于标签/占位符)
```

**规则 3：accent 色在亮色下需要更深**

```
暗色：--accent: #d4764e（珊瑚色，在深色背景上很醒目）
亮色：--accent: #c06a3e（同色系但更深，在浅色背景上才有足够对比度）
```

同样的 `#d4764e` 在白色背景上对比度只有 ~3.2:1，不达标。加深到 `#c06a3e` 后对比度 ~4.6:1，刚好达标。

**规则 4：半透明色的 alpha 值需要调整**

```
暗色：--accent-soft: rgba(212, 118, 78, 0.12)  ← 在深色背景上 12% 就够明显
亮色：--accent-soft: rgba(192, 106, 62, 0.08)   ← 在浅色背景上 8% 就够，12% 太重
```

亮色背景上同样的颜色更"显眼"，所以 alpha 要降低。

**规则 5：边框方向反转**

```
暗色：--border: rgba(255, 255, 255, 0.06)  ← 白色半透明（在深色背景上）
亮色：--border: rgba(0, 0, 0, 0.08)        ← 黑色半透明（在浅色背景上）
```

暗色主题的边框是"白色微光"，亮色主题的边框是"黑色微影"。

#### 完整色板对比表

| 变量 | 暗色值 | 亮色值 | 转换逻辑 |
|------|--------|--------|---------|
| `--bg` | `#0d0c0e` | `#f7f3ee` | 深黑 → 暖白 |
| `--bg-surface` | `#161518` | `#ffffff` | 深灰 → 纯白 |
| `--bg-elevated` | `#1e1c21` | `#f0ebe4` | 中灰 → 浅暖灰 |
| `--bg-hover` | `#252329` | `#e8e2d9` | 浅灰 → 暖灰 |
| `--fg` | `#e8e2d9` | `#1a1714` | 亮色 → 深色（反转） |
| `--fg-secondary` | `#a09a92` | `#5c5650` | 中亮 → 中暗 |
| `--fg-muted` | `#6b665f` | `#8a847e` | 暗灰 → 浅灰 |
| `--accent` | `#d4764e` | `#c06a3e` | 珊瑚色加深 |
| `--accent-soft` | `rgba(212,118,78,0.12)` | `rgba(192,106,62,0.08)` | alpha 降低 |
| `--border` | `rgba(255,255,255,0.06)` | `rgba(0,0,0,0.08)` | 白光 → 黑影 |
| `--bar-bg` | `rgba(13,12,14,0.8)` | `rgba(247,243,238,0.85)` | 半透明跟随主题 |
| `--overlay-bg` | `rgba(0,0,0,0.6)` | `rgba(0,0,0,0.3)` | 亮色下遮罩更轻 |
| `--shadow-sm` | `rgba(0,0,0,0.2)` | `rgba(0,0,0,0.06)` | 亮色下阴影更轻 |

### 四、useTheme Hook 设计详解

#### 完整代码逐行解析

```typescript
import { useState, useEffect, useCallback } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'companion-theme';

// 主题对应的 meta theme-color 值
const META_THEME_COLORS: Record<Theme, string> = {
  dark: '#0d0c0e',
  light: '#f7f3ee',
};
```

**为什么用 `Record<Theme, string>` 而不是两个变量？**

- 类型安全：如果以后新增主题（如 `dim`），TypeScript 会强制你补全对应的颜色
- 一处定义，查找方便

```typescript
function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {}
  // localStorage 可能被隐私模式禁用，try-catch 必不可少
  if (window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';  // 默认暗色
}
```

**优先级链：localStorage 手动选择 > 系统偏好 > 默认暗色**

1. 用户手动选过 → 尊重用户选择（最高优先级）
2. 没选过但系统是亮色 → 跟随系统
3. 都没有 → 默认暗色（聊天应用暗色更舒适）

```typescript
function updateMetaThemeColor(t: Theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', META_THEME_COLORS[t]);
}
```

**为什么不用 `meta.content = ...`？**

`setAttribute` 是更通用的写法，对于自定义 meta 标签更可靠。

```typescript
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    updateMetaThemeColor(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {}
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggleTheme };
}
```

**为什么 `toggleTheme` 用 `useCallback`？**

- `toggleTheme` 会被传给按钮的 `onClick`
- 不包 `useCallback` 的话，每次渲染都会创建新函数，导致按钮不必要的重渲染
- 空依赖数组 `[]` 表示函数永远不会变

**为什么在 `App.tsx` 中也调用 `useTheme()`？**

`ChatHeader` 中的 `useTheme` 负责切换按钮的渲染和交互。但 `App.tsx` 中也调用一次，确保 `useEffect`（设置 `data-theme` 和 `localStorage`）在应用最顶层就执行。这样即使 `ChatHeader` 还没渲染，主题就已经初始化了。

### 五、FOUC 防闪烁的完整方案

#### 问题复现

没有防闪烁时，亮色主题用户的加载过程：

```
时间线：
0ms   HTML 开始解析
      → <html> 没有 data-theme 属性
      → CSS :root 变量生效（暗色）
      
50ms  CSS 加载完成
      → 页面渲染为暗色 ← 用户看到了暗色！

200ms React JS 加载完成
      → useTheme 读取 localStorage
      → 设置 data-theme="light"
      → CSS 变量切换为亮色 ← 闪烁！
```

用户看到：暗色 → 亮色的闪烁，体验很差。

#### 解决方案：内联脚本

```html
<head>
  <meta name="theme-color" content="#0d0c0e" />
  <script>
    (function(){
      try {
        var t = localStorage.getItem('companion-theme');
        if (t === 'light') {
          document.documentElement.setAttribute('data-theme', 'light');
          document.querySelector('meta[name="theme-color"]').content = '#f7f3ee';
        }
      } catch(e){}
    })();
  </script>
  <!-- CSS 在后面加载，但 data-theme 已经设置好了 -->
  <link href="..." rel="stylesheet" />
</head>
```

修复后的时间线：

```
0ms   HTML 开始解析
      → <script> 同步执行
      → 读取 localStorage → 设置 data-theme="light"
      → 更新 meta theme-color
      
50ms  CSS 加载完成
      → [data-theme="light"] 选择器匹配
      → 亮色变量生效 ← 首次渲染就是亮色！✅

200ms React JS 加载完成
      → useTheme 读取 localStorage → 'light'
      → data-theme 已经是 'light'，无需变更 ✅
```

**关键要点：**

1. 脚本必须在 `<head>` 中，CSS `<link>` 之前
2. 脚本必须是同步的（不能 `async` 或 `defer`），否则可能在 CSS 之后执行
3. 只处理 `light` 的情况：因为默认就是暗色，不需要额外设置
4. `try-catch` 必不可少：隐私模式下 `localStorage` 会抛异常

### 六、移动端主题切换的特殊考虑

#### 1. meta theme-color 的重要性

桌面浏览器没有地址栏颜色概念，但移动端浏览器有：

```
Chrome Android：地址栏颜色跟随 theme-color
Safari iOS：状态栏颜色跟随 apple-mobile-web-app-status-bar-style
PWA 模式：启动画面颜色跟随 theme-color
```

如果不联动更新：

```
暗色主题 → 地址栏是暗色 #0d0c0e ✅
切换到亮色 → 地址栏还是暗色 #0d0c0e ❌ 突兀！
```

#### 2. 滚动条在亮色主题下的样式

暗色主题的滚动条是"深色轨道 + 浅色滑块"：

```css
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.08);  /* 白色半透明滑块 */
}
```

亮色主题下这个滑块几乎看不见（白色在白色背景上）。需要覆盖：

```css
[data-theme="light"] ::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.12);  /* 黑色半透明滑块 */
}
```

#### 3. 移动端切换按钮的触摸友好设计

```css
.theme-toggle {
  width: 36px;       /* ≥ 44pt 的一半，但实际触摸区域由 padding 撑大 */
  height: 36px;
  border-radius: var(--radius-sm);
  /* ... */
}

.theme-toggle:active {
  transform: scale(0.92);  /* 按压反馈 */
}
```

在移动端，36px 的视觉尺寸加上 8px 的 padding，实际触摸区域约 44px，满足 Apple HIG 要求。

### 踩坑记录

- **输入框外层 div 可被选中**：`#input-area` 没有设置 `user-select: none`，点击空白处会出现蓝色选中状态。但 textarea 内部不受影响，因为表单元素的 `user-select` 默认值是 `contain`，不继承父元素的 `none`。
- **硬编码颜色是主题切换的天敌**：任何直接写的 `rgba(13, 12, 14, ...)` 或 `rgba(0, 0, 0, ...)` 在亮色主题下都会暴露问题。必须全部提取为 CSS 变量。
- **亮色主题下毛玻璃效果需要不同底色**：`backdrop-filter: blur()` 的效果取决于底层颜色，暗色用 `rgba(13,12,14,0.8)` 亮色用 `rgba(247,243,238,0.85)` 才能保持一致的模糊质感。
- **亮色下遮罩层太重**：暗色用 `rgba(0,0,0,0.6)` 做遮罩，直接用在亮色上太暗了。亮色下改为 `rgba(0,0,0,0.3)` 更合适。

---

## 2026-06-09 | Docker 部署详解

> 以下内容面向没有 Docker 使用经验的开发者，从零开始解释 Docker 是什么、为什么需要它、以及本项目的 Docker 部署方案是如何设计的。

### 一、Docker 是什么？为什么需要它？

#### 没有 Docker 时的部署流程

假设你要把项目部署到一台新服务器上，你需要：

```
1. 安装 Node.js 24          ← 版本不对？编译失败
2. 安装 Python 3.12         ← 版本不对？依赖冲突
3. 安装 PostgreSQL 16       ← 还要装 pgvector 扩展
4. 安装 pip/uv              ← Python 包管理器
5. 安装 npm 依赖            ← 网络问题？依赖缺失？
6. 安装 Python 依赖         ← 同上
7. 下载 ONNX 模型           ← 400MB 文件
8. 配置环境变量             ← 漏配一个？服务启动失败
9. 配置 Nginx 反向代理      ← 还要装 Nginx
10. 配置进程守护            ← 服务挂了要自动重启
11. 配置防火墙规则          ← 端口暴露
```

**问题：** 每换一台服务器就要重来一遍，而且不同服务器环境可能不同（操作系统、库版本、权限等），经常出现"在我电脑上能跑"的问题。

#### 有了 Docker 后

```
1. 安装 Docker              ← 只需要这一个
2. docker compose up        ← 一条命令，所有服务自动启动
```

Docker 把应用和它的整个运行环境（操作系统、依赖库、配置文件）打包成一个**镜像（Image）**。镜像可以在任何安装了 Docker 的机器上运行，保证环境完全一致。

#### 核心概念

| 概念 | 类比 | 说明 |
|------|------|------|
| **镜像（Image）** | 安装光盘 | 只读模板，包含运行应用所需的一切 |
| **容器（Container）** | 运行中的虚拟机 | 镜像的运行实例，互相隔离 |
| **Dockerfile** | 安装脚本 | 描述如何构建镜像的步骤 |
| **docker-compose.yml** | 编排清单 | 定义多个容器如何协作 |
| **Volume** | 外接硬盘 | 容器删除后数据不丢失的存储 |
| **Registry** | 应用商店 | Docker Hub 等镜像仓库 |

#### Docker vs 虚拟机

```
虚拟机：
┌─────────────────────────────┐
│  应用 A  │  应用 B  │ 应用 C │
├──────────┼──────────┼────────┤
│  完整OS  │  完整OS  │ 完整OS │  ← 每个 VM 都有自己的操作系统，占几个 GB
├──────────┴──────────┴────────┤
│         宿主机 OS             │
├──────────────────────────────┤
│           硬件               │
└──────────────────────────────┘

Docker：
┌────────┬────────┬────────┐
│ 应用 A │ 应用 B │ 应用 C │
├────────┴────────┴────────┤
│      Docker 引擎          │  ← 共享宿主机内核，每个容器只占几十 MB
├──────────────────────────┤
│       宿主机 OS           │
├──────────────────────────┤
│         硬件              │
└──────────────────────────┘
```

- Docker 容器共享宿主机内核，不需要每个容器都装一个完整 OS
- 容器启动只需秒级，虚拟机需要分钟级
- 容器占用资源少（MB 级），虚拟机占用多（GB 级）

### 二、Dockerfile 详解

#### 什么是 Dockerfile？

Dockerfile 是一个文本文件，包含构建镜像的每一步指令。Docker 按顺序执行这些指令，最终生成一个可运行的镜像。

#### 本项目的 API Dockerfile

```dockerfile
# syntax=docker/dockerfile:1    ← 启用 Docker BuildKit 语法增强

# ──── 第 1 阶段：安装 API 依赖 ────
FROM node:24-bookworm-slim AS api-deps
# FROM：基于哪个镜像开始。node:24-bookworm-slim 是 Node.js 24 的精简版
# AS：给这个阶段起名，后面可以引用

WORKDIR /app                    # 设置工作目录为 /app
COPY package*.json ./           # 只复制 package.json（利用 Docker 缓存）
RUN npm ci                      # 安装依赖（ci = clean install，比 install 更严格）

# ──── 第 2 阶段：安装 Web 前端依赖 ────
FROM node:24-bookworm-slim AS web-deps
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci

# ──── 第 3 阶段：编译所有代码 ────
FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY --from=api-deps /app/node_modules ./node_modules     # 从第 1 阶段复制依赖
COPY --from=web-deps /app/web/node_modules ./web/node_modules  # 从第 2 阶段复制依赖
COPY . .                        # 复制所有源代码
RUN npm run build:web           # 编译 React 前端 → web/dist
RUN npm run build               # 编译 NestJS 后端 → dist

# ──── 第 4 阶段：运行时镜像 ────
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production         # 设置生产环境变量
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force  # 只装生产依赖 + 清缓存
COPY --from=builder /app/dist ./dist              # 从编译阶段复制后端产物
COPY --from=builder /app/web/dist ./web/dist      # 从编译阶段复制前端产物
EXPOSE 3000                     # 声明容器监听端口
CMD ["node", "dist/main.js"]    # 容器启动时执行的命令
```

#### 为什么要用多阶段构建？

```
不用多阶段构建：
  镜像包含：Node.js + npm + TypeScript + 所有源码 + 编译产物 + 开发依赖
  镜像大小：~1.5 GB

使用多阶段构建：
  镜像包含：Node.js + 生产依赖 + 编译产物
  镜像大小：~300 MB
  
节省了 80%！因为编译工具（TypeScript、Vite、ESBuild 等）只在构建时需要，
运行时不需要。多阶段构建只把最终产物复制到精简的运行时镜像中。
```

#### Docker 缓存机制

Docker 构建镜像时，每一步都会生成一个中间层。如果 Dockerfile 和输入文件没变，Docker 会复用缓存的中间层，不重新执行。

```
COPY package*.json ./    ← package.json 没变 → 复用缓存 ✅
RUN npm ci               ← 上一条复用了缓存 → 这条也复用 ✅

COPY . .                 ← 源码变了 → 缓存失效 ❌
RUN npm run build        ← 上一条缓存失效 → 这条也失效 ❌
```

**最佳实践：** 先 `COPY package*.json` + `RUN npm ci`，再 `COPY . .`。这样只要依赖不变，安装步骤就能复用缓存，只重新编译源码。

#### Python Embedding Dockerfile

```dockerfile
FROM python:3.12-slim AS runtime
WORKDIR /app

# 防止 Python 生成 .pyc 文件和写入字节码缓存
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# 安装 uv（新一代 Python 包管理器，比 pip 快 10-100 倍）
RUN pip install --no-cache-dir uv

# 先复制依赖声明文件（利用缓存）
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev    # --frozen：严格按 lock 文件安装；--no-dev：不装开发依赖

# 复制源码
COPY main.py embedder.py ./
RUN mkdir -p /app/models         # 创建模型目录（模型文件通过 volume 挂载，不打入镜像）

EXPOSE 8000
CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**为什么模型不打入镜像？**

ONNX 模型文件约 400MB。如果打入镜像：
- 每次构建镜像都要复制 400MB
- 推送/拉取镜像都很慢
- 模型更新要重新构建镜像

通过 volume 挂载（`./python/models:/app/models:ro`）：
- 镜像只有几十 MB
- 模型文件独立管理，更新不影响镜像
- `:ro` 表示只读挂载，容器不会修改模型文件

### 三、docker-compose.yml 详解

#### 什么是 Docker Compose？

Docker Compose 是一个编排工具，用一个 YAML 文件定义多个容器如何协作。相当于"一键启动整个应用栈"。

#### 完整解析

```yaml
services:                          # 定义所有服务（容器）

  # ──── 服务 1：PostgreSQL 数据库 ────
  postgres:
    image: pgvector/pgvector:pg16  # 使用 pgvector 官方镜像（PostgreSQL 16 + 向量扩展）
    container_name: companion-postgres
    environment:                    # 环境变量（创建数据库时的配置）
      POSTGRES_USER: ${DB_USER:-postgres}       # ${VAR:-default} 表示：有 VAR 用 VAR，没有用 default
      POSTGRES_PASSWORD: ${DB_PASSWORD:-postgres}
      POSTGRES_DB: ${DB_NAME:-companion}
    ports:
      - "${DB_PORT:-54321}:5432"   # 宿主机端口:容器端口
                                    # 54321 是你电脑上的端口，5432 是容器内的端口
                                    # 这样不会和你电脑上已有的 PostgreSQL 冲突
    volumes:
      - postgres_data:/var/lib/postgresql/data  # 数据持久化：数据库文件存在命名卷中
    healthcheck:                    # 健康检查：Docker 定期执行这个命令判断服务是否正常
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-postgres} -d ${DB_NAME:-companion}"]
      interval: 5s                  # 每 5 秒检查一次
      timeout: 5s                   # 超时 5 秒算失败
      retries: 20                   # 连续失败 20 次才标记为 unhealthy

  # ──── 服务 2：Python Embedding 服务 ────
  embedding:
    build:
      context: ./python             # 构建上下文：在 python/ 目录下找 Dockerfile
    container_name: companion-embedding
    environment:
      MOCK_EMBEDDING: ${MOCK_EMBEDDING:-0}       # 0=真实模型，1=Mock
      EMBEDDING_MODEL_PATH: ${EMBEDDING_MODEL_PATH:-/app/models/jina-embeddings-v2-base-zh.onnx}
      EMBEDDING_TOKENIZER_PATH: ${EMBEDDING_TOKENIZER_PATH:-/app/models/tokenizer.json}
    ports:
      - "${EMBEDDING_PORT:-8000}:8000"
    volumes:
      - ./python/models:/app/models:ro  # 挂载本地模型目录到容器内，:ro=只读
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"]
      interval: 10s
      timeout: 5s
      retries: 20

  # ──── 服务 3：NestJS API + Web 前端 ────
  api:
    build:
      context: .                    # 构建上下文：项目根目录
    container_name: companion-api
    environment:
      NODE_ENV: production
      PORT: ${PORT:-3000}
      DB_HOST: postgres             # ← 关键！不是 localhost，而是服务名 postgres
      DB_PORT: 5432                 # ← 容器内部端口，不是宿主机端口
      DB_USER: ${DB_USER:-postgres}
      DB_PASSWORD: ${DB_PASSWORD:-postgres}
      DB_NAME: ${DB_NAME:-companion}
      DB_LOGGING: ${DB_LOGGING:-false}
      DEEPSEEK_API_KEY: ${DEEPSEEK_API_KEY}   # LLM API Key，必须配置
      PYTHON_EMBED_URL: http://embedding:8000  # ← 服务名 embedding，不是 localhost
    ports:
      - "${PORT:-3000}:3000"
    depends_on:                     # 依赖关系：等这两个服务健康后才启动
      postgres:
        condition: service_healthy
      embedding:
        condition: service_healthy
    restart: unless-stopped         # 除非手动停止，否则自动重启

volumes:
  postgres_data:                    # 命名卷：Docker 管理的持久化存储
```

#### 关键概念详解

**1. 端口映射 `ports: "宿主机端口:容器端口"`**

```
你的电脑（宿主机）          Docker 容器
                    ┌──────────────┐
  localhost:54321 ──┤──→ :5432     │  postgres
                    │              │
  localhost:8000  ──┤──→ :8000     │  embedding
                    │              │
  localhost:3000  ──┤──→ :3000     │  api
                    └──────────────┘
```

- 容器内部服务监听自己的端口（5432、8000、3000）
- 宿主机通过映射端口访问（54321、8000、3000）
- 不同容器的内部端口可以相同（互相隔离），但宿主机端口不能冲突

**2. 服务发现 `DB_HOST: postgres`**

在 Docker Compose 的内部网络中，服务名就是主机名：

```
API 容器内：
  DB_HOST=postgres  → 解析为 postgres 容器的 IP 地址
  PYTHON_EMBED_URL=http://embedding:8000  → 解析为 embedding 容器的 IP 地址
```

**绝对不能用 `localhost`！** 因为每个容器有自己的网络命名空间，`localhost` 指的是容器自己，不是宿主机。

**3. 健康检查 `healthcheck`**

```
启动顺序：
  1. postgres 启动 → 每 5s 检查 pg_isready → 通过后标记 healthy
  2. embedding 启动 → 每 10s 检查 /health → 通过后标记 healthy
  3. api 启动（depends_on condition: service_healthy）
     → postgres 和 embedding 都 healthy 后才开始启动
```

没有健康检查的话，API 可能在数据库还没准备好时就启动，导致连接失败。

**4. Volume 数据持久化**

```
docker compose down       → 停止并删除容器，但 postgres_data 卷保留 ✅
docker compose down -v    → 停止并删除容器，同时删除卷 ❌ 数据全没了
```

Volume 的生命周期独立于容器。即使容器被删除重建，数据库数据依然存在。

**5. 环境变量替换 `${VAR:-default}`**

```yaml
POSTGRES_USER: ${DB_USER:-postgres}
# 如果 .env.docker 中定义了 DB_USER=admin → 使用 admin
# 如果没定义 → 使用默认值 postgres
```

### 四、.dockerignore 详解

#### 为什么需要 .dockerignore？

`COPY . .` 会把当前目录所有文件复制到镜像中。但有些文件不应该进入镜像：

```
node_modules/     ← 开发依赖，镜像中通过 npm ci 重新安装
dist/             ← 编译产物，镜像中通过 npm run build 重新生成
.git/             ← Git 历史，运行时不需要
.env              ← 可能包含密钥，不能打入镜像！
*.log             ← 日志文件
python/models/*.onnx  ← 400MB 模型文件，通过 volume 挂载
```

#### 本项目的 .dockerignore

```
node_modules              ← API 的开发依赖
dist                      ← API 编译产物
web/node_modules          ← 前端的开发依赖
web/dist                  ← 前端编译产物
python/.venv              ← Python 虚拟环境
python/__pycache__        ← Python 字节码缓存
python/**/*.pyc           ← Python 编译缓存
python/models/*.onnx      ← ONNX 模型（太大，volume 挂载）
exports                   ← 导出数据
coverage                  ← 测试覆盖率
pgdata                    ← 本地 PostgreSQL 数据
.git                      ← Git 历史
.env                      ← 环境变量（可能含密钥）
*.log                     ← 日志
tsconfig.build.tsbuildinfo ← TypeScript 增量编译缓存
web/tsconfig.tsbuildinfo  ← 同上
```

### 五、部署流程详解

#### 步骤 1：准备环境变量

```powershell
# 复制模板
copy .env.docker.example .env.docker

# 编辑 .env.docker，至少修改这两项：
# DB_PASSWORD=change-me        ← 改成强密码
# DEEPSEEK_API_KEY=sk-xxxx     ← 填入你的 DeepSeek API Key
```

#### 步骤 2：准备 Embedding 模型

**方式 A：使用 Mock 模式（快速测试）**

```text
# .env.docker 中设置
MOCK_EMBEDDING=1
```

Mock 模式不加载真实模型，返回随机向量。适合测试 Docker 栈是否能正常启动。

**方式 B：使用真实模型（生产推荐）**

```powershell
cd python
python scripts/download_model.py   # 下载 ONNX 模型 + tokenizer
```

下载后 `python/models/` 目录会包含：
- `jina-embeddings-v2-base-zh.onnx`（~400MB）
- `tokenizer.json`

#### 步骤 3：构建并启动

```powershell
# 构建镜像 + 启动所有服务
docker compose --env-file .env.docker up --build

# 后台运行（加 -d）
docker compose --env-file .env.docker up --build -d
```

**`--env-file .env.docker`**：指定环境变量文件，而不是默认的 `.env`

**`--build`**：每次启动前重新构建镜像（确保代码变更生效）

#### 步骤 4：访问应用

```
http://localhost:3000    ← Web 聊天界面
```

#### 步骤 5：停止服务

```powershell
# 停止并删除容器（保留数据库数据）
docker compose --env-file .env.docker down

# 停止并删除容器 + 数据库数据
docker compose --env-file .env.docker down -v

# 查看运行状态
docker compose --env-file .env.docker ps

# 查看日志
docker compose --env-file .env.docker logs api
docker compose --env-file .env.docker logs -f    # -f 实时跟踪
```

### 六、Docker 常用命令速查

| 命令 | 说明 |
|------|------|
| `docker compose up` | 启动所有服务 |
| `docker compose up -d` | 后台启动 |
| `docker compose up --build` | 重新构建镜像后启动 |
| `docker compose down` | 停止并删除容器 |
| `docker compose down -v` | 停止并删除容器 + 卷 |
| `docker compose ps` | 查看服务状态 |
| `docker compose logs api` | 查看 API 日志 |
| `docker compose logs -f` | 实时跟踪所有日志 |
| `docker compose restart api` | 重启 API 服务 |
| `docker compose build` | 只构建镜像，不启动 |
| `docker images` | 查看本地所有镜像 |
| `docker system prune` | 清理未使用的镜像/容器/网络 |

### 七、常见问题排查

#### 1. 端口被占用

```
Error: Bind for 0.0.0.0:3000 failed: port is already allocated
```

解决：修改 `.env.docker` 中的端口映射，如 `PORT=3001`

#### 2. 数据库连接失败

```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

原因：API 容器内不能用 `localhost` 连接数据库，必须用服务名 `postgres`。检查 `docker-compose.yml` 中 `DB_HOST: postgres`。

#### 3. Embedding 服务健康检查失败

```
embedding is unhealthy
```

排查：
```powershell
docker compose --env-file .env.docker logs embedding  # 查看日志
```

常见原因：模型文件不存在且 `MOCK_EMBEDDING=0`。改为 `MOCK_EMBEDDING=1` 或下载模型。

#### 4. 镜像构建失败

```
npm ERR! code ERESOLVE
```

原因：依赖版本冲突。尝试：
```powershell
docker compose build --no-cache api  # 不用缓存重新构建
```

#### 5. 容器内无法访问宿主机服务

如果 API 需要访问宿主机上的其他服务（如本地 LLM），使用特殊 DNS：

```
host.docker.internal    # Docker Desktop 提供的特殊域名，指向宿主机
```

### 踩坑记录

- **模型文件打入镜像导致镜像过大**：最初考虑把 ONNX 模型打入 embedding 镜像，但 400MB 的模型会让镜像构建和推送非常慢。改为 volume 挂载后，镜像只有几十 MB。
- **DB_HOST 不能用 localhost**：在 Docker Compose 网络中，每个容器有独立的网络命名空间，`localhost` 指向容器自己。必须用服务名（如 `postgres`）访问其他容器。
- **健康检查避免启动顺序问题**：最初没有健康检查，API 在数据库还没准备好时就启动导致连接失败。加上 `depends_on: condition: service_healthy` 后，API 会等待数据库就绪。
- **npm ci vs npm install**：Dockerfile 中用 `npm ci` 而不是 `npm install`。`ci` 严格按照 `package-lock.json` 安装，结果可复现；`install` 可能自动升级依赖，导致不同构建产生不同结果。

### 设计决策

- **多阶段构建而非单阶段**：最终运行时镜像只包含 Node.js + 生产依赖 + 编译产物，体积从 ~1.5GB 降到 ~300MB。
- **PostgreSQL 用官方 pgvector 镜像**：不需要自己安装 pgvector 扩展，一条 `image: pgvector/pgvector:pg16` 就搞定。
- **环境变量默认值**：`docker-compose.yml` 中所有变量都有 `:-default`，不配 `.env.docker` 也能启动（除了 `DEEPSEEK_API_KEY`）。
- **命名卷而非绑定挂载**：数据库数据用 `postgres_data` 命名卷而不是 `./pgdata` 绑定挂载。命名卷由 Docker 管理，权限和性能更好。
- **Embedding 模型只读挂载**：`./python/models:/app/models:ro`，`:ro` 防止容器意外修改模型文件。

---

## 2026-06-09 | 开发环境 vs Docker 部署：启动策略选择

### 一、为什么开发环境不用 Docker？

Docker 的核心优势是"环境一致性"，但开发时最需要的是**热更新（Hot Reload）**：

```
本地开发（热更新）：
  改一行 CSS → 保存 → 浏览器 0.5 秒自动刷新 → 立即看到效果 ✅

Docker 开发（无热更新）：
  改一行 CSS → 保存 → 重新构建镜像（30秒~2分钟）→ 重启容器 → 才能看到效果 ❌
```

Docker 每次改代码都要重新构建镜像，这个等待时间在频繁调试时不可接受。

### 二、热更新是什么？

热更新是指代码修改后，**不需要手动刷新页面或重启服务**，应用自动更新。

| 技术 | 热更新方式 | 速度 |
|------|-----------|------|
| Vite（前端） | HMR（Hot Module Replacement）：只替换修改的模块，不刷新整个页面 | < 1 秒 |
| NestJS（后端） | `start:dev` 使用 `tsc --watch`，代码变更自动重新编译并重启 | 2-3 秒 |
| Python（Embedding） | `uvicorn --reload`，文件变更自动重启 | 1-2 秒 |
| Docker | ❌ 没有热更新，必须重新构建镜像 | 30 秒 ~ 2 分钟 |

### 三、推荐的开发启动方式：混合策略

**原则：数据库用 Docker，代码本地跑。**

```powershell
# ──── 终端 1：数据库（Docker） ────
docker start companion-pg
# 或者用 docker compose 只启动数据库：
# docker compose --env-file .env.docker up postgres -d

# ──── 终端 2：Python Embedding（本地，Mock 模式） ────
cd python
MOCK_EMBEDDING=1 .\.venv\Scripts\uvicorn.exe main:app --port 8000

# ──── 终端 3：NestJS API（本地，热更新） ────
npm run start:dev

# ──── 终端 4：前端（本地，Vite HMR） ────
cd web
npm run dev
```

#### 为什么数据库用 Docker？

| 对比 | 本地安装 PostgreSQL | Docker 跑 PostgreSQL |
|------|-------------------|---------------------|
| 安装 | 下载安装包 + 配置 + 装 pgvector 扩展 | 一条命令 |
| 版本管理 | 多版本共存麻烦 | 不同项目用不同容器互不干扰 |
| 清理 | 卸载可能有残留 | `docker rm` 干干净净 |
| 数据隔离 | 多个项目共用一个实例 | 每个项目独立容器 |
| 你会改数据库代码吗？ | 不会 | 不会 → 不需要热更新 |

**数据库不需要热更新**，因为你不会在开发时修改 PostgreSQL 的源码。所以用 Docker 跑数据库完全没有缺点。

#### 为什么 Embedding 用 Mock 模式？

```
真实模式：加载 400MB ONNX 模型 → 启动慢 → 占内存 → 开发时向量搜索结果不影响 UI 调试
Mock 模式：返回随机向量 → 启动快 → 省内存 → UI 调试足够
```

只有在调试记忆检索功能时才需要真实 Embedding，其他时候 Mock 就够。

### 四、两种部署方式的完整对比

| 对比项 | 本地开发启动 | Docker 一键启动 |
|--------|------------|----------------|
| 前置要求 | Node.js + Python + Docker | 只需 Docker |
| 启动命令 | 3-4 个终端 | 1 条命令 |
| 热更新 | ✅ 前端 < 1s，后端 2-3s | ❌ 需重新构建 |
| 适用场景 | 日常开发调试 | 部署 / 演示 / 完整测试 |
| 端口 | 3000(API) + 5173(前端) + 8000(Embedding) | 3000（统一入口） |
| 资源占用 | 较低（Mock Embedding） | 较高（构建镜像需要内存） |

### 五、远程部署的两种方式

#### 方式一：源码部署

```
你的电脑 ── git clone/scp ──→ 服务器
                              │
                              │ docker compose up --build
                              ▼
                           运行中
```

- 把源码传到服务器
- 在服务器上构建并启动
- 服务器需要足够内存来编译
- 简单直接，适合个人项目

#### 方式二：镜像仓库部署

```
你的电脑 ── build+push ──→ 镜像仓库 ── pull ──→ 服务器
                                                    │
                                                    │ docker compose up
                                                    ▼
                                                 运行中
```

- 在本地构建镜像，推送到仓库（Docker Hub / 阿里云 ACR）
- 服务器只拉取镜像运行，不参与编译
- 更安全（源码不暴露在服务器上）
- 适合正式生产环境和 CI/CD

#### 怎么选？

| 场景 | 推荐方式 |
|------|---------|
| 个人项目 / 小团队 | 源码部署，够用 |
| 正式生产环境 | 镜像仓库，更安全更规范 |
| CI/CD 自动化 | 镜像仓库，GitHub Actions 构建推送，服务器只拉取 |
| 服务器配置低 | 镜像仓库，编译在你电脑上完成，服务器只管运行 |

### 设计决策

- **开发环境混合策略**：数据库 Docker + 代码本地跑，兼顾环境一致性和热更新效率
- **Mock Embedding 为开发默认**：日常开发不需要真实向量搜索，Mock 模式启动快、省内存
- **Docker 用于部署而非开发**：Docker 解决"环境一致性"问题，但牺牲了"开发效率"，各取所长

---

## 2026-06-09 | start.bat 开发启动器

### 一、Windows bat 脚本基础

#### 常用命令

| 命令 | 说明 | 示例 |
|------|------|------|
| `@echo off` | 关闭命令回显，让输出更干净 | 脚本开头必加 |
| `echo` | 输出文字 | `echo Hello World` |
| `start "标题" cmd /k "命令"` | 新窗口执行命令，窗口保持打开 | `start "API" cmd /k "npm run dev"` |
| `cd /d %~dp0` | 切换到 bat 文件所在目录 | `%~dp0` 是 bat 文件所在路径 |
| `if %errorlevel% neq 0` | 判断上一条命令是否失败 | `neq` = not equal |
| `>nul 2>&1` | 静默执行，不输出任何内容 | `docker --version >nul 2>&1` |
| `pause` | 暂停，等用户按键 | 脚本结尾，防止窗口闪退 |
| `chcp 65001` | 切换控制台编码为 UTF-8 | 支持中文显示 |
| `::` 或 `rem` | 注释 | `:: 这是注释` |

#### `start` 命令详解

```bat
start "窗口标题" cmd /k "要执行的命令"
```

- `"窗口标题"`：新窗口的标题栏文字，方便识别
- `cmd /k`：执行命令后**保持窗口打开**（`/c` 是执行后关闭）
- 每个服务一个独立窗口，关闭窗口 = 停止该服务

#### `%~dp0` 是什么？

```
假设 start.bat 在 D:\Code\AI\companion\start.bat

%~dp0 = D:\Code\AI\companion\    （带末尾反斜杠）

cd /d %~dp0python  →  切换到 D:\Code\AI\companion\python
cd /d %~dp0web     →  切换到 D:\Code\AI\companion\web
```

`%0` 是脚本自身路径，`%~d` 提取盘符，`%~p` 提取路径，`%~dp0` 合起来就是脚本所在目录。

### 二、start.bat 的设计逻辑

#### 启动流程

```
双击 start.bat
    │
    ├─ 检查 Docker ─── 不存在 → 提示安装，退出
    ├─ 检查 Node.js ── 不存在 → 提示安装，退出
    ├─ 检查 uv ─────── 不存在 → 提示安装，退出
    │
    ├─ [1/4] PostgreSQL
    │   ├─ docker start companion-pg（尝试复用已有容器）
    │   └─ 失败 → docker compose up postgres -d（创建新容器）
    │
    ├─ [2/4] Python Embedding（新窗口）
    │   └─ MOCK_EMBEDDING=1 uv run uvicorn main:app --port 8000 --reload
    │
    ├─ [3/4] NestJS API（新窗口）
    │   └─ npm run start:dev
    │
    └─ [4/4] Web 前端（新窗口）
        └─ npm run dev
```

#### 数据库智能启动

```bat
docker start companion-pg >nul 2>&1
if %errorlevel% neq 0 (
    docker compose --env-file .env.docker up postgres -d
)
```

- 第一次运行：`companion-pg` 容器不存在 → `docker start` 失败 → 回退到 `docker compose up`
- 后续运行：容器已存在但可能停止 → `docker start` 直接启动，比 `docker compose up` 更快

#### 环境变量设置

```bat
set MOCK_EMBEDDING=1 && uv run uvicorn main:app --port 8000 --reload
```

- `set MOCK_EMBEDDING=1`：设置环境变量，让 Python 使用 Mock 向量
- `&&`：前一条成功才执行后一条
- `--reload`：Python 热更新，修改代码自动重启

### 三、为什么每个服务用独立窗口？

| 方案 | 优点 | 缺点 |
|------|------|------|
| 所有服务同一窗口 | 节省屏幕空间 | 一个服务崩溃日志被其他服务刷走，难以排查 |
| 每服务独立窗口 | 日志隔离，关闭单个窗口停止单个服务 | 占 4 个窗口 |

独立窗口更实用：开发时通常只关注 API 和前端日志，数据库和 Embedding 的窗口可以最小化。

### 踩坑记录

- **`cd` 不能跨盘符**：`cd D:\other` 在 C 盘下不会切换。必须用 `cd /d D:\other`，`/d` 表示同时切换盘符和目录。
- **`set` 环境变量作用域**：`set MOCK_EMBEDDING=1` 只在当前 cmd 会话生效。用 `start cmd /k "set VAR=1 && command"` 可以在新窗口中设置。
- **`chcp 65001` 防止中文乱码**：Windows 默认使用 GBK 编码，`echo` 输出中文会乱码。`chcp 65001` 切换到 UTF-8 编码。

### 设计决策

- **前置检查而非启动后报错**：缺少依赖时立即提示并退出，避免启动到一半才发现缺 Docker 或 Node.js
- **数据库优先复用已有容器**：`docker start` 比 `docker compose up` 快，且不会重建容器
- **Embedding 默认 Mock 模式**：开发时 99% 不需要真实向量，Mock 启动快、省内存
- **独立窗口而非同一窗口**：日志隔离，方便排查问题，关闭单个窗口即可停止单个服务
