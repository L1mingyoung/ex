@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0export_wechat_current_chat.ps1" -SelectAll %*
endlocal
