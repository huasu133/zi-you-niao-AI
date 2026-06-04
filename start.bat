@echo off
cd /d "F:\ziyouniao"
set NODE="C:\Users\song\.workbuddy\binaries\node\versions\22.22.2\node.exe"

echo 自由鸟 启动中...

:: 检查端口是否已被占用
netstat -ano | findstr ":3456" | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo 端口 3456 已被占用，尝试先关闭旧进程...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3456" ^| findstr "LISTENING"') do taskkill /f /pid %%a >nul 2>&1
    timeout /t 2 /nobreak >nul
)

:: 后台启动Node服务
start "" /B %NODE% app.js

:: 健康检查等待（最多重试10次，每次1秒）
echo 等待服务就绪...
set RETRY=0
:health_check
timeout /t 1 /nobreak >nul
curl -s http://127.0.0.1:3456/health >nul 2>&1
if %errorlevel% equ 0 goto server_ready
set /a RETRY+=1
if %RETRY% lss 10 goto health_check

echo 启动失败: 服务未响应，请检查 F:\ziyouniao\.env 和 F:\ziyouniao\app.js
pause
exit /b 1

:server_ready
echo 服务已就绪
start "" http://127.0.0.1:3456
echo 完成
