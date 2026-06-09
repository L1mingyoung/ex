@echo off
chcp 65001 >nul 2>&1
title AI Companion - 开发启动器

echo ========================================
echo   AI Companion - 开发环境一键启动
echo ========================================
echo.

:: ---- 检查 Docker ----
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Docker，请先安装 Docker Desktop
    echo        https://www.docker.com/products/docker-desktop
    pause
    exit /b 1
)

:: ---- 检查 Node.js ----
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js 24
    pause
    exit /b 1
)

:: ---- 检查 uv ----
uv --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 uv，请先安装 uv
    echo        https://docs.astral.sh/uv/getting-started/installation/
    pause
    exit /b 1
)

echo [1/4] 启动 PostgreSQL (Docker)...
docker start companion-pg >nul 2>&1
if %errorlevel% neq 0 (
    echo       容器不存在，使用 docker compose 启动...
    docker compose --env-file .env.docker up postgres -d
    if %errorlevel% neq 0 (
        echo [错误] PostgreSQL 启动失败，请检查 Docker 是否运行
        pause
        exit /b 1
    )
)
echo       PostgreSQL 已启动

echo [2/4] 启动 Python Embedding (Mock 模式)...
start "Embedding Service" cmd /k "cd /d %~dp0python && set MOCK_EMBEDDING=1 && uv run uvicorn main:app --port 8000 --reload"

echo [3/4] 启动 NestJS API (热更新)...
start "API Server" cmd /k "cd /d %~dp0 && npm run start:dev"

echo [4/4] 启动 Web 前端 (Vite HMR)...
start "Web Dev" cmd /k "cd /d %~dp0web && npm run dev"

echo.
echo ========================================
echo   所有服务已启动！
echo ========================================
echo.
echo   PostgreSQL:  localhost:54321
echo   Embedding:   localhost:8000  (Mock 模式)
echo   API:         localhost:3000
echo   Web:         localhost:5173
echo.
echo   提示：关闭对应窗口即可停止服务
echo ========================================
echo.
pause
