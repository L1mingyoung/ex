# AI Companion 云服务器部署指南

> 本地打包镜像 → 上传服务器 → 一键启动。
> 服务器 IP：`62.234.150.98`（腾讯云轻量应用服务器，用户 `ubuntu`）

---

## 整体架构

```
云服务器 (62.234.150.98)
├── PostgreSQL + pgvector    （数据库，内部端口 5432）
├── Python Embedding         （向量服务，内部端口 8000）
├── NestJS API + Web 前端    （对外端口 3000）
└── QQ Bot 适配器            （WebSocket 出站，无需入站端口）
```

部署完成后：

- **Web 前端**：`http://62.234.150.98:3000`
- **QQ Bot**：后台自动运行，QQ 里私聊或 @机器人 触发

---

## 第一步：服务器安装 Docker

SSH 连上服务器后执行：

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装 Docker
curl -fsSL https://get.docker.com | sh
sudo apt install -y docker-compose-plugin

# 当前用户加入 docker 组（免 sudo）
sudo usermod -aG docker $USER
```

> **重新 SSH 登录**才生效。验证：`docker ps` 不报 permission denied。

---

## 第二步：克隆代码

```bash
sudo apt install -y git
cd ~
git clone https://gitee.com/l1anyue/ex.git
cd ex
```

---

## 第三步：创建 .env 配置文件

```bash
cd ~/ex
nano .env
```

粘贴以下内容（按实际情况修改）：

```env
# ===== 数据库 =====
DB_USER=postgres
DB_PASSWORD=你的强密码
DB_NAME=companion
DB_PORT=55432
DB_LOGGING=false

# ===== LLM =====
DEEPSEEK_API_KEY=sk-你的密钥

# ===== 向量服务（首次用 Mock，后续上传模型后改 0） =====
MOCK_EMBEDDING=1

# ===== API =====
PORT=3000

# ===== QQ Bot（可选） =====
QQ_BOT_APP_ID=你的AppID
QQ_BOT_APP_SECRET=你的AppSecret
QQ_BOT_SANDBOX=1
QQ_CHARACTER_ID=xiaoya
```

保存：`Ctrl+O` → 回车 → `Ctrl+X` 退出

---

## 第四步：开放防火墙端口

腾讯云控制台 → 轻量应用服务器 → 防火墙，添加：

| 协议 | 端口 | 来源      | 说明         |
| ---- | ---- | --------- | ------------ |
| TCP  | 3000 | 0.0.0.0/0 | Web 前端+API |

> **不要开放**数据库（55432）和向量服务（8000）端口。

---

## 第五步：加载镜像 + 启动服务

> 镜像由本地 Windows 打包上传（见下方「本地打包流程」）。

```bash
cd ~/ex

# 加载本地打包的镜像
docker load -i companion-images.tar

# 启动核心服务（数据库 + 向量 + API）
docker compose -f docker-compose.prod.yml up -d

# 如果需要 QQ Bot，加 --profile qqbot
docker compose -f docker-compose.prod.yml --profile qqbot up -d
```

### 查看状态

```bash
docker compose -f docker-compose.prod.yml ps

# 期望输出：
# companion-postgres    Up (healthy)
# companion-embedding   Up (healthy)
# companion-api         Up
# companion-qqbot       Up          ← 如果启动了 QQ Bot
```

### 查看日志

```bash
# 所有日志
docker compose -f docker-compose.prod.yml logs -f

# 只看某个服务
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f qqbot
```

---

## 第六步：创建角色（首次部署）

QQ Bot 需要关联一个角色。在服务器上执行：

```bash
curl -X POST http://localhost:3000/api/characters \
  -H "Content-Type: application/json" \
  -d '{
    "id": "xiaoya",
    "name": "小雅",
    "base_prompt": "你是小雅，一个温柔体贴的女生。善于倾听，能感受到对方的情绪，给予温暖回应。说话自然亲切，像朋友聊天。"
  }'
```

或者在浏览器 `http://62.234.150.98:3000` 里用界面创建。

---

## 第七步：验证

```bash
# 检查数据库
docker exec -it companion-postgres psql -U postgres -d companion -c "SELECT 1;"

# 检查向量服务
curl http://localhost:8000/health

# 检查 API
curl http://localhost:3000/api/characters
```

浏览器打开 `http://62.234.150.98:3000`，看到界面即成功。

---

## 第八步：QQ Bot 接入（可选）

### 8.1 QQ 开放平台配置

1. 登录 https://q.qq.com → 进入你的机器人应用
2. **沙箱管理** → 添加测试 QQ 号（单聊沙箱）和测试群号（群聊沙箱）
3. **功能配置** → 开启 C2C 消息 和 群聊 @消息

### 8.2 启动 QQ Bot

```bash
docker compose -f docker-compose.prod.yml --profile qqbot up -d
```

### 8.3 验证连接

```bash
docker compose -f docker-compose.prod.yml logs -f qqbot
```

成功日志：

```
[QQ Bot] 连接网关 wss://sandbox.api.sgroup.qq.com/websocket...
[QQ Bot] 已连接
[Auth] Token 获取成功
[QQ Bot] 鉴权成功，Bot: 你的机器人名
```

### 8.4 在 QQ 里测试

- **私聊**：QQ 搜索你的机器人 → 发消息
- **群聊**：在测试群里 @机器人 发消息

---

## 本地打包流程（Windows）

在本地 Windows 双击 `deploy.bat`，自动完成：

```
构建镜像 → docker save 导出 → scp 上传到服务器
```

或手动执行：

```bash
cd d:\Code\AI\companion

# 构建镜像
docker build -t companion-api:latest .
docker build -t companion-embedding:latest ./python

# 导出为 tar
docker save companion-api:latest companion-embedding:latest -o companion-images.tar

# 上传到服务器
scp companion-images.tar ubuntu@62.234.150.98:~/ex/
```

---

## 日常运维

```bash
cd ~/ex

# ===== 服务管理 =====
docker compose -f docker-compose.prod.yml ps                  # 查看状态
docker compose -f docker-compose.prod.yml restart             # 重启全部
docker compose -f docker-compose.prod.yml restart api         # 重启 API
docker compose -f docker-compose.prod.yml stop                # 停止全部
docker compose -f docker-compose.prod.yml logs -f             # 查看日志

# ===== QQ Bot =====
docker compose -f docker-compose.prod.yml restart qqbot       # 重启 QQ Bot
docker compose -f docker-compose.prod.yml logs -f qqbot       # QQ Bot 日志

# ===== 更新部署 =====
git pull                                                      # 拉取最新代码
docker load -i companion-images.tar                           # 加载新镜像（本地重新打包后上传）
docker compose -f docker-compose.prod.yml up -d               # 启动
docker compose -f docker-compose.prod.yml --profile qqbot up -d  # 含 QQ Bot

# ===== 数据库 =====
docker exec -it companion-postgres psql -U postgres -d companion  # 进入数据库
docker exec -t companion-postgres pg_dump -U postgres companion > backup.sql  # 备份

# ===== 清理 =====
docker system prune -f                                        # 清理旧镜像
```

---

## 开机自启

```bash
sudo systemctl enable docker
```

Docker 容器已配 `restart: unless-stopped`，服务器重启后自动恢复。

---

## 常见问题

| 问题                | 解决                                                            |
| ------------------- | --------------------------------------------------------------- |
| `permission denied` | 重新 SSH 登录，或 `sudo docker compose ...`                     |
| 端口 3000 被占      | `sudo lsof -i :3000` → `sudo kill -9 <PID>`                     |
| 浏览器打不开        | 检查防火墙是否开放 3000 端口                                    |
| 数据库连接错误      | 等几秒，`docker compose ps postgres` 看是否 healthy             |
| QQ Bot 收不到私聊   | 检查 intents 是否含 `(1<<30)`，检查沙箱是否添加你的 QQ 号       |
| QQ Bot 群聊不回复   | 需要 @机器人 才会触发，检查沙箱群配置                           |
| 磁盘空间不足        | `docker system prune -af`                                       |
| Mock 切真实模型     | 上传 .onnx 文件 → `.env` 改 `MOCK_EMBEDDING=0` → 重启 embedding |
