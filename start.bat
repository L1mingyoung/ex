@echo off
echo ========================================
echo   AI Companion - 启动指南
echo ========================================
echo.
echo 请分别打开 3 个终端：
echo.
echo   终端1 (数据库): docker start companion-pg
echo.
echo   终端2 (Python): cd python
echo                  uv run uvicorn main:app --port 8000
echo.
echo   终端3 (NestJS): cd companion
echo                  npm run start:dev
echo.
echo   终端4 (web): cd web
echo                  npm run dev
echo ========================================
echo   测试: node test_chat.js
echo ========================================
