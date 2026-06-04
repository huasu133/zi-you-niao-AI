@echo off
cd /d "F:\ziyouniao"
set NODE="C:\Users\song\.workbuddy\binaries\node\versions\22.22.2\node.exe"

echo 自由鸟 启动中...

:: 后台启动Node服务
start "" /B %NODE% app.js

:: 等5秒让服务就绪
ping 127.0.0.1 -n 6 >nul

:: 打开浏览器
start "" http://127.0.0.1:3456

echo 完成
exit
