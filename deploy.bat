@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

:: ===== 配置 =====
set SERVER=ubuntu@62.234.150.98
set REMOTE_DIR=~/ex

echo.
echo ============================================
echo   AI Companion 一键部署脚本
echo   本地打包镜像 → 上传服务器 → 启动服务
echo ============================================
echo.

:: ===== 第一步：构建镜像 =====
echo [1/4] 构建 companion-api 镜像（--no-cache 确保最新代码）...
docker build --no-cache -t companion-api:latest .
if errorlevel 1 (
    echo 构建 API 镜像失败！
    pause
    exit /b 1
)

echo [2/4] 构建 companion-embedding 镜像（--no-cache）...
docker build --no-cache -t companion-embedding:latest ./python
if errorlevel 1 (
    echo 构建 Embedding 镜像失败！
    pause
    exit /b 1
)

:: ===== 第二步：导出镜像 =====
echo [3/4] 导出镜像为 tar 文件...
docker save companion-api:latest companion-embedding:latest -o companion-images.tar
if errorlevel 1 (
    echo 导出镜像失败！
    pause
    exit /b 1
)

:: 显示文件大小
for %%F in (companion-images.tar) do echo     镜像大小: %%~zF bytes

:: ===== 第三步：上传到服务器 =====
echo [4/4] 上传镜像到服务器 %SERVER%...
echo     文件较大，请耐心等待（可能需要几分钟到十几分钟）...
scp -o ConnectTimeout=30 -o ServerAliveInterval=60 -o ServerAliveCountMax=3 companion-images.tar %SERVER%:%REMOTE_DIR%/
if errorlevel 1 (
    echo 上传失败！请检查 SSH 连接。
    pause
    exit /b 1
)

echo.
echo ============================================
echo   上传完成！
echo.
echo   接下来在服务器上执行：
echo.
echo   ssh %SERVER%
echo   cd %REMOTE_DIR%
echo   docker load -i companion-images.tar
echo   docker compose -f docker-compose.prod.yml up -d
echo.
echo   如果要启动 QQ Bot：
echo   docker compose -f docker-compose.prod.yml --profile qqbot up -d
echo ============================================
echo.

:: 清理本地 tar 文件
del companion-images.tar 2>nul

pause
