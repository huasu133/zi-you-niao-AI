@echo off
cd /d F:\ziyouniao
set NPM_DIR=C:\Users\song\.workbuddy\binaries\node\versions\22.22.2
set PATH=%NPM_DIR%;%PATH%

echo 自由鸟启动中...
start http://127.0.0.1:3456
node app.js
pause
