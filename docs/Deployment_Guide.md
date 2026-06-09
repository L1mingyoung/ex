# AI Companion 云服务器部署指南

> 从零开始，手把手教你在云服务器上部署 AI Companion。
> 服务器 IP：`62.234.150.98`（腾讯云轻量应用服务器）

---

## 整体架构

```
云服务器
├── Docker Compose 一键启动
│   ├── PostgreSQL + pgvector（数据库，端口 55432）
│   ├── Python Embedding（向量服务，端口 8000）
│   └── NestJS API + Web 前端（端口 3000）
│
└── QQ Bot 适配器（独立进程，可选）
```

部署完成后：

- **Web 前端**：浏览器访问 `http://62.234.150.98:3000`
- **API 接口**：`http://62.234.150.98:3000/api/...`
- **QQ Bot**：后台自动运行，通过 WebSocket 连接 QQ 网关

---

## 第一步：安装 Docker

SSH 连上服务器后，执行以下命令（Ubuntu / Debian 系统）：

```bash
# 更新系统包
sudo apt update && sudo apt upgrade -y

# 安装 Docker（官方一键安装脚本）
curl -fsSL https://get.docker.com | sh

# 安装 Docker Compose 插件（docker-compose.yml 需要）
sudo apt install -y docker-compose-plugin

# 把当前用户加入 docker 组（避免每次都输 sudo）
sudo usermod -aG docker $USER

# 验证安装
docker --version
docker compose version
```

> **注意：** `usermod` 加组后需要**重新 SSH 登录**才生效。重新连一次即可。
>
> 验证：执行 `docker ps`，如果不报错（不显示 permission denied），说明配置成功。

---

## 第二步：上传项目代码

有两种方式：

### 方式 A：Git 拉取（推荐，代码在 GitHub 上）

```bash
# 在服务器上安装 Git
sudo apt install -y git

# 创建项目目录
mkdir -p /opt/companion
cd /opt/companion

# 拉取代码
git clone https://github.com/你的用户名/companion.git .
```

### 方式 B：从本地上传（scp）

在你的 **Windows 本地** 新开一个终端（不是 SSH 窗口），执行：

```bash
scp -r D:\Code\AI\companion root@62.234.150.98:/opt/companion
```

> scp 会自动排除 `node_modules` 等（它们在 `.gitignore` 里，但 scp 不会看 gitignore）。
> 如果不想传 node_modules，可以先压缩再传：
>
> ```bash
> # Windows PowerShell（排除不需要的目录）
> tar -czf companion.tar.gz --exclude=node_modules --exclude=.venv --exclude=dist companion
> scp companion.tar.gz root@62.234.150.98:/opt/
> # 服务器上解压
> ssh root@62.234.150.98 "cd /opt && tar -xzf companion.tar.gz && mv companion companion-app"
> ```

---

## 第三步：上传 ONNX 模型文件

**模型文件约 612MB**，已加入 `.gitignore` 不会随 Git 上传，需要单独传。

有两种选择：

### 选择 A：使用 Mock 模式（跳过，推荐首次部署）

Mock 模式不需要真实模型，向量服务返回随机向量。**功能正常，只是记忆检索不准确**。

跳到第四步时，在 `.env` 中设置：

```env
MOCK_EMBEDDING=1
```

### 选择 B：上传真实模型

在 Windows 本地执行（另开终端）：

```bash
scp D:\Code\AI\companion\python\models\jina-embeddings-v2-base-zh.onnx root@62.234.150.98:/opt/companion/python/models/
scp D:\Code\AI\companion\python\models\tokenizer.json root@62.234.150.98:/opt/companion/python/models/
```

或者在服务器上用下载脚本：

```bash
cd /opt/companion/python
python3 scripts/download_model.py
```

---

## 第四步：创建 .env 配置文件

```bash
cd /opt/companion

# 用 nano 编辑器创建配置文件
nano .env
```

把以下内容粘贴进去（按你的实际情况修改）：

```env
# ===== 数据库 =====
DB_USER=postgres
DB_PASSWORD=这里设一个强密码
DB_NAME=companion
DB_PORT=55432
DB_LOGGING=false

# ===== LLM =====
DEEPSEEK_API_KEY=sk-你的DeepSeek密钥

# ===== Python 向量服务 =====
# 首次部署用 Mock 模式，后续上传模型后改为 0
MOCK_EMBEDDING=1
PYTHON_EMBED_URL=http://localhost:8000

# ===== NestJS =====
PORT=3000

# ===== QQ Bot（可选，不用可删掉） =====
QQ_BOT_APP_ID=你的QQBotAppID
QQ_BOT_APP_SECRET=你的QQBotAppSecret
QQ_CHARACTER_ID=test1
```

保存：`Ctrl+O` → 回车 → `Ctrl+X` 退出

> **密码建议：** 用 `openssl rand -hex 16` 生成一个随机密码

---

## 第五步：Docker Compose 一键启动

```bash
cd /opt/companion

# 构建并启动所有服务（后台运行）
docker compose up -d --build
```

首次执行会：

1. 拉取 `pgvector/pgvector:pg16` 和 `python:3.12-slim` 和 `node:24-bookworm-slim` 镜像
2. 构建 NestJS + Web 前端
3. 构建 Python 向量服务
4. 启动三个容器

大约需要 **5-10 分钟**（取决于服务器网速）。

### 查看启动状态

```bash
# 查看所有容器状态
docker compose ps

# 期望输出：
# NAME                  STATUS
# companion-postgres    Up (healthy)
# companion-embedding   Up (healthy)
# companion-api         Up
```

### 查看日志

```bash
# 查看所有服务日志
docker compose logs

# 只看 API 日志
docker compose logs api

# 只看数据库日志
docker compose logs postgres

# 实时跟踪日志（Ctrl+C 退出）
docker compose logs -f api
```

---

## 第六步：验证服务

### 6.1 检查数据库

```bash
docker exec -it companion-postgres psql -U postgres -d companion -c "SELECT 1 AS ok;"
```

应输出 `ok` 和 `1`。

### 6.2 检查向量服务

```bash
curl http://localhost:8000/health
```

应返回：

```json
{ "status": "ok", "mock_mode": true, "dimensions": 768 }
```

### 6.3 检查 API

```bash
curl http://localhost:3000/api/characters
```

应返回 JSON 数组（可能为空 `[]`）。

### 6.4 浏览器访问

打开浏览器，访问：

```
http://62.234.150.98:3000
```

如果能看到 Web 界面，部署成功！

---

## 第七步：开放防火墙端口

腾讯云需要在控制台配置安全组（防火墙规则）：

登录 [腾讯云控制台](https://console.cloud.tencent.com/lighthouse) → 轻量应用服务器 → 防火墙

添加规则：

| 协议 | 端口 | 来源      | 说明                      |
| ---- | ---- | --------- | ------------------------- |
| TCP  | 3000 | 0.0.0.0/0 | Web 前端 + API            |
| TCP  | 22   | 你的IP/32 | SSH（限制你的 IP 更安全） |

> **不要开放** 55432（数据库）和 8000（向量服务），它们只在服务器内部通信。

---

## 第八步：QQ Bot 启动（可选）

QQ Bot 已集成到 Docker Compose，使用 `profiles` 按需启动。

### 方式 A：Docker 启动（推荐）

```bash
cd /opt/companion

# 启动所有服务 + QQ Bot
docker compose --profile qqbot up -d

# 查看 QQ Bot 日志
docker compose logs -f qqbot

# 只重启 QQ Bot
docker compose restart qqbot
```

> **说明：** QQ Bot 使用 Docker Compose 的 `profiles` 功能，
> 默认的 `docker compose up -d` **不会启动** QQ Bot，
> 需要加 `--profile qqbot` 才会启动。

### 方式 B：PM2 启动（不用 Docker）

```bash
# 安装 Node.js 24
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

# 安装依赖
cd /opt/companion
npm install ws dotenv

# 安装 PM2
sudo npm install -g pm2

# 启动 QQ Bot
pm2 start adapters/qq-bot/index.js --name qq-bot
pm2 logs qq-bot

# 设置开机自启
pm2 startup
pm2 save
```

---

## 第九步：设置开机自启

Docker 容器已经配了 `restart: unless-stopped`，服务器重启后会自动启动。

确认 Docker 服务本身开机自启：

```bash
sudo systemctl enable docker
```

QQ Bot 的 PM2 在上一步已设置 `pm2 startup` + `pm2 save`。

---

## 日常运维命令速查

### Docker Compose

```bash
cd /opt/companion

# 查看所有容器状态
docker compose ps

# 重启所有服务
docker compose restart

# 重启单个服务
docker compose restart api

# 查看实时日志
docker compose logs -f

# 停止所有服务
docker compose stop

# 停止并删除容器（数据不丢）
docker compose down

# 重新构建并启动（代码更新后）
docker compose up -d --build

# 清理旧的构建缓存
docker system prune -f
```

### QQ Bot（Docker 方式）

```bash
# 查看状态
docker compose ps qqbot

# 重启
docker compose restart qqbot

# 查看日志
docker compose logs -f qqbot

# 停止 QQ Bot
docker compose stop qqbot
```

### QQ Bot（PM2 方式）

```bash
# 查看状态
pm2 status

# 重启
pm2 restart qq-bot

# 查看日志
pm2 logs qq-bot

# 停止
pm2 stop qq-bot
```

### 数据库

```bash
# 进入数据库
docker exec -it companion-postgres psql -U postgres -d companion

# 备份数据库（在服务器上执行）
docker exec -t companion-postgres pg_dump -U postgres companion > backup.sql

# 恢复数据库
cat backup.sql | docker exec -i companion-postgres psql -U postgres -d companion
```

---

## 更新代码后的重新部署

```bash
cd /opt/companion

# 拉取最新代码
git pull

# 重新构建并启动（Docker 会自动只重建变化的部分）
docker compose up -d --build

# 如果 QQ Bot 代码有改动，也要重启
pm2 restart qq-bot
```

---

## 常见问题

### Q1: `docker compose up` 报错 permission denied

重新 SSH 登录，或者临时用 sudo：

```bash
sudo docker compose up -d --build
```

### Q2: 端口 3000 被占用

```bash
# 查看谁占了 3000 端口
sudo lsof -i :3000

# 杀掉占用进程
sudo kill -9 <PID>
```

### Q3: 浏览器打不开 3000 端口

检查腾讯云防火墙规则是否已开放 3000 端口（第七步）。

### Q4: API 报数据库连接错误

等几秒，数据库可能还在初始化。检查：

```bash
docker compose ps postgres
# 状态应该是 "Up (healthy)"
```

### Q5: 磁盘空间不足

```bash
# 查看磁盘使用
df -h

# 清理 Docker 无用镜像和缓存
docker system prune -af --volumes
```

### Q6: Mock 模式切真实模型

1. 上传模型文件（第三步 B）
2. 修改 `.env`：`MOCK_EMBEDDING=0`
3. 重启 embedding 服务：

```bash
docker compose up -d --build embedding
```

---

## 部署完成后的文件结构

```
/opt/companion/
├── .env                    ← 你的配置文件（不在 Git 里）
├── docker-compose.yml
├── Dockerfile
├── python/
│   ├── Dockerfile
│   ├── models/
│   │   ├── jina-embeddings-v2-base-zh.onnx  ← 需要单独上传
│   │   └── tokenizer.json
│   └── ...
├── adapters/qq-bot/        ← QQ Bot（PM2 管理）
└── ...
```
