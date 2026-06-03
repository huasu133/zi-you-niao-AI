@echo off
cd /d F:\ziyouniao

set NPM_DIR=C:\Users\song\.workbuddy\binaries\node\versions\22.22.2
set PATH=%NPM_DIR%;%PATH%

echo ======================================
echo 自由鸟 Electron 打包安装工具
echo ======================================
echo.
echo 步骤 1/2: 安装依赖...
echo.

call "%NPM_DIR%\npm" install
if %errorlevel% neq 0 (
    echo.
    echo ❌ 安装失败，请检查网络连接后重试
    pause
    exit /b 1
)
echo.
echo ✅ 依赖安装完成
echo.
echo 步骤 2/2: 打包成 exe...
echo 这需要几分钟，请耐心等待...
echo.

call "%NPM_DIR%\node.exe" node_modules\.bin\electron-builder --win
if %errorlevel% neq 0 (
    echo.
    echo ❌ 打包失败
    pause
    exit /b 1
)
echo.
echo ======================================
echo ✅ 打包完成！
echo 安装包位置: F:\ziyouniao\dist\
echo 文件名: 自由鳥 Setup 1.0.0.exe
echo ======================================
echo.
pause
