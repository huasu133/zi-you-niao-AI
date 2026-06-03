# 自由鸟 v4 DevOps 部署终审报告

> 审查人: devops | 审查日期: 2026-06-03

## 一、审查范围

| 文件 | 大小 | 角色 |
|------|------|------|
| `自由鸟.vbs` | 6 行 | 静默启动脚本（VBScript） |
| `start.bat` | 31 行 | 命令行启动脚本（带输出） |
| `app.js` | 290 行 | 服务主进程（Express + OpenAI 对话） |
| `package.json` | 24 行 | npm 配置与依赖声明 |
| `.env` | 12 行 | 环境变量（含端口 PORT=3456） |

**审查对象**: 启动流程、进程管理、端口配置、快捷方式部署

---

## 二、现状诊断

### 2.1 启动流程 — 存在两套脚本，未统一

#### 自由鸟.vbs

```vbscript
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "F:\ziyouniao"
WshShell.Run "cmd /c cd /d F:\ziyouniao && node app.js", 0, False
WScript.Sleep 3000
WshShell.Run """C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"" --app=http://localhost:3456 --window-size=1100,750", 1, False
```

| 项目 | 评价 |
|------|------|
| 静默启动（第 2 个参数=0） | ✅ 无 CMD 黑窗口 |
| 等待 3 秒后打开浏览器 | ⚠️ 硬编码等待，服务未就绪时浏览器打开空白页 |
| Edge 路径硬编码 | 🔴 `Program Files (x86)` vs `Program Files` 因系统不同而异 |
| 无错误处理 | 🔴 node 启动失败时不提示，浏览器仍打开 |
| 无进程退出传递 | 🔴 `False` 参数不等待 node 进程，VBS 结束后无感知 |

#### start.bat

| 项目 | 评价 |
|------|------|
| `start` 命令启动 node | ✅ 新窗口可见，方便排查 |
| 多浏览器检测（Edge x64/x86/Chrome） | ✅ 覆盖主要场景 |
| fallback 到默认浏览器 | ✅ 容错性较好 |
| 硬编码 3 秒等待 | ⚠️ 同上 |
| `pause` 停在末尾 | ✅ 用户可看到输出 |

#### 两套脚本对比

| 维度 | 自由鸟.vbs | start.bat |
|------|:---:|:---:|
| 用户可见 CMD 窗口 | 无 | 有（node 窗口 + 启动窗口） |
| 错误处理 | 无 | 无 |
| 浏览器兼容性 | 仅 Edge x86 路径 | Edge x64/x86 + Chrome |
| 适合场景 | 日常双击使用 | 调试/排查 |

> **结论**: 两套脚本功能重叠但未统一，维护时容易被遗漏。`.vbs` 偏向最终用户使用，`.bat` 偏向开发者调试。

---

### 2.2 进程管理 — 无守护，风险高

#### 当前状态

```
node app.js 直接运行，无进程管理器守护
```

| 缺失能力 | 影响 |
|----------|------|
| **自动重启** | `uncaughtException` / `unhandledRejection` 会导致进程退出，服务中断 |
| **开机自启** | 每次重启电脑需手动启动 |
| **日志管理** | 依赖 console.log，无持久化日志文件 |
| **状态监控** | 无 CPU/内存/请求量监控 |
| **零停机重载** | 更新代码需手动 kill + 重启 |

#### app.js 中与进程管理相关的代码（问题点）

```javascript
// app.js:21-30 — 异常处理直接退出
process.on('uncaughtException', err => {
  console.error('未捕获异常，进程退出:', err)
  process.exitCode = 1
  setTimeout(() => process.exit(1), 1000)  // 硬退出，无重启
})
process.on('unhandledRejection', (reason, promise) => {
  console.error('未捕获 Promise 拒绝:', reason)
  process.exitCode = 1
  setTimeout(() => process.exit(1), 1000)  // 同上
})
```

| 问题 | 说明 |
|------|------|
| `process.exit(1)` | 进程硬终止，不会自动恢复 |
| 缺失 `SIGTERM`/`SIGINT` | 优雅关闭未实现，连接可能被暴力断开 |
| 缺失 `uncaughtExceptionMonitor` | 更细粒度的异常监控未使用 |

#### 好消息：pm2 已在系统中可用

```
pm2 已安装（C:\Users\song\.pm2）
```

---

### 2.3 端口配置 — 绑定 0.0.0.0，有安全隐患

#### 代码层面

```javascript
// app.js:278
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`自由鸟 v4 运行在 http://127.0.0.1:${PORT}`)
})
```

| 问题 | 说明 |
|------|------|
| 绑定 `0.0.0.0` | 监听所有网络接口，局域网内任何机器可访问 |
| 但日志显示 `127.0.0.1` | 日志打印的是 localhost，容易让人误以为只监听本地 |
| 端口硬编码 | `.env` 中 PORT=3456，`.vbs` 和 `.bat` 中也是硬编码 localhost:3456，改端口需改 3 处 |

#### 防火墙状态

```
端口 3456 当前无防火墙规则 → 处于监听状态但仅本地可访问
Windows 防火墙默认阻止入站，所以外部暂时安全
```

#### 网络状态验证

```
TCP  0.0.0.0:3456  0.0.0.0:0  LISTENING  PID 4972 (node)
```

---

### 2.4 快捷方式 — 桌面快捷方式缺失

| 预期 | 实际 |
|------|------|
| 桌面 `自由鸟.lnk` | ❌ **不存在** |
| 项目目录 `start - 快捷方式.lnk` | ✅ 存在于 `F:\ziyouniao\` |

用户桌面没有快捷方式，需要在项目目录中双击 `自由鸟.vbs` 或 `start.bat`。

---

## 三、改进建议

### 严重 🔴

| # | 问题 | 当前状态 | 建议方案 |
|---|------|----------|----------|
| 1 | **无进程守护** | 直接 `node app.js` | 使用 pm2 管理进程：`pm2 start app.js --name ziyouniao` + `pm2 save` + `pm2 startup` |
| 2 | **崩溃自动退出无重启** | `process.exit(1)` | 由 pm2 接管（`max_restarts: 10`, `restart_delay: 5000`） |
| 3 | **缺失优雅关闭** | 无 SIGTERM 处理 | 添加 `process.on('SIGTERM', () => server.close(...))`，pm2 发送 SIGINT 前等待连接排空 |
| 4 | **绑定 0.0.0.0 且无认证** | `app.listen(PORT, '0.0.0.0')` | 改为 `127.0.0.1`（本地部署场景），或保留 0.0.0.0 但添加 API 密钥认证 |

### 中等 🟡

| # | 问题 | 当前状态 | 建议方案 |
|---|------|----------|----------|
| 5 | **两套启动脚本未统一** | `.vbs` + `.bat` | 以 `.vbs` 为主（用户日常使用），`.bat` 简化为纯调试工具，统一等待逻辑 |
| 6 | **硬编码 3 秒等待** | 两处 `Sleep 3000` / `timeout /t 3` | 改为轮询 `/health` 端点，就绪后再打开浏览器 |
| 7 | **Edge 路径硬编码** | `.vbs` 仅 x86 路径 | 使用 `start.bat` 中的浏览器检测逻辑，或用 `start msedge` 利用系统 PATH |
| 8 | **桌面快捷方式缺失** | 无 `桌面 自由鸟.lnk` | 创建指向 `自由鸟.vbs` 的快捷方式，复制到 `%USERPROFILE%\Desktop\` |
| 9 | **无日志持久化** | console.log 输出 | pm2 自带日志管理，或添加 winston/bunyan 输出到 `logs/` 目录 |

### 轻微 🟢

| # | 问题 | 当前状态 | 建议方案 |
|---|------|----------|----------|
| 10 | **无新版 Node 检查** | `engines: node >= 18` | start.bat 开头添加 `node --version` 检查，版本不够时提示 |
| 11 | **VBS 不传工作目录给 node** | `cmd /c cd /d ...` | VBS 已设 `CurrentDirectory`，但子进程的 CMD 中冗余 `cd /d` |
| 12 | **端口变更需改多处** | `.env` / `.vbs` / `.bat` 三处硬编码 | 启动脚本读取 `.env` 中的 PORT（或统一用 `lsof -ti:3456` 检测运行端口） |
| 13 | **无健康检查自动恢复** | 仅 `/health` 端点存在 | 配合 pm2 或 Windows 任务计划做定时健康检查：`curl http://localhost:3456/health`，失败则重启 |

---

## 四、推荐部署方案

### 4.1 pm2 生态配置文件

创建 `F:\ziyouniao\ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'ziyouniao',
    script: 'app.js',
    cwd: 'F:/ziyouniao',
    env: { PORT: 3456, NODE_ENV: 'production' },
    // 进程管理
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    // 优雅关闭
    kill_timeout: 5000,
    listen_timeout: 10000,
    // 日志
    error_file: 'F:/ziyouniao/logs/err.log',
    out_file: 'F:/ziyouniao/logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
  }]
}
```

部署命令：

```bash
pm2 start ecosystem.config.js
pm2 save          # 保存进程列表
pm2 startup       # 设置开机自启（需要管理员权限执行）
```

### 4.2 改进后的启动脚本（自由鸟.vbs）

```vbscript
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "F:\ziyouniao"

' 启动 pm2（如已运行则跳过）
WshShell.Run "cmd /c pm2 start ecosystem.config.js", 0, True

' 轮询等待服务就绪
Dim i, status
For i = 1 To 15
    WScript.Sleep 1000
    On Error Resume Next
    status = WshShell.Run("powershell -NoProfile -Command ""(Invoke-WebRequest http://localhost:3456/health -UseBasicParsing -TimeoutSec 1).StatusCode""", 0, True)
    If status = 0 Then Exit For
Next

' 打开浏览器（多种方式检测）
Dim app, edgePaths
edgePaths = Array( _
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", _
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe" _
)
app = ""
For Each p In edgePaths
    Set fso = CreateObject("Scripting.FileSystemObject")
    If fso.FileExists(p) Then
        app = Chr(34) & p & Chr(34)
        Exit For
    End If
Next
If app = "" Then app = "start"

WshShell.Run app & " --app=http://localhost:3456 --window-size=1100,750", 1, False
```

### 4.3 改进后的 start.bat（调试用）

```batch
@echo off
cd /d F:\ziyouniao
echo ============================
echo   自由鸟 v4 调试模式
echo ============================

:: Node 版本检查
node --version >nul 2>&1 || (echo 错误: 未安装 Node.js & pause & exit /b 1)

:: 检查是否已运行
curl -s http://localhost:3456/health >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [信息] 服务已在运行 http://localhost:3456
    goto :open
)

:: 启动 pm2
echo [启动] pm2 启动服务...
call pm2 start ecosystem.config.js

:: 等待就绪
echo [等待] 服务就绪中...
for /L %%i in (1,1,15) do (
    timeout /t 1 /nobreak >nul
    curl -s http://localhost:3456/health >nul 2>&1 && goto :open
)

echo [警告] 服务启动超时，请检查 pm2 logs

:open
echo [打开] 浏览器...
start msedge --app=http://localhost:3456 --window-size=1100,750 2>nul || start http://localhost:3456
pause
```

### 4.4 桌面快捷方式创建

```batch
powershell -Command ^
"$WshShell = New-Object -ComObject WScript.Shell; " ^
"$Shortcut = $WshShell.CreateShortcut('$env:USERPROFILE\Desktop\自由鸟.lnk'); " ^
"$Shortcut.TargetPath = 'F:\ziyouniao\自由鸟.vbs'; " ^
"$Shortcut.WorkingDirectory = 'F:\ziyouniao'; " ^
"$Shortcut.IconLocation = 'F:\ziyouniao\ziyouniao-icon.ico,0'; " ^
"$Shortcut.Description = '自由鸟 v4 - 自托管 AI 助手'; " ^
"$Shortcut.Save()"
```

---

## 五、可选增强（未来考虑）

| 增强项 | 说明 |
|--------|------|
| **Windows 服务包装** | 使用 `node-windows` 或 `winsw` 将 pm2 包装为 Windows 服务，实现系统级开机自启 |
| **HTTPS 本地** | 生成自签名证书，`localhost:3456` → `https://localhost:3456` |
| **自动更新** | `git pull` + `npm install` + `pm2 restart ziyouniao` 一键更新脚本 |
| **磁盘容量监控** | 日志/记忆文件大小告警 |
| **健康检查告警** | Windows 定时任务 + 钉钉/微信通知 |

---

## 六、与 app.js 代码需协同修改

以下修改需要在 app.js 中配合实现：

```javascript
// 1. 监听地址改为 127.0.0.1（本地部署）
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`自由鸟 v4 运行在 http://127.0.0.1:${PORT}`)
})

// 2. 优雅关闭
let shuttingDown = false
process.on('SIGTERM', () => {
  if (shuttingDown) return
  shuttingDown = true
  console.log('收到 SIGTERM，优雅关闭中...')
  server.close(() => {
    console.log('HTTP 服务已关闭')
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10000) // 10 秒超时强制退出
})

process.on('SIGINT', () => {
  console.log('收到 SIGINT，即将关闭...')
  process.exit(0)
})
```

---

## 七、综合评定

| 维度 | 评分 | 说明 |
|------|:---:|------|
| 启动流程 | ⭐⭐⭐☆☆ 3/5 | 两套脚本功能可用但重复，缺乏健康检查等待 |
| 进程管理 | ⭐⭐☆☆☆ 2/5 | 无守护/无重启/无日志/无开机自启，4 项基本能力缺失 |
| 端口配置 | ⭐⭐⭐☆☆ 3/5 | 功能正常，但 0.0.0.0 绑定 + 无认证有安全隐患 |
| 快捷方式 | ⭐⭐☆☆☆ 2/5 | 桌面快捷方式缺失 |
| 可运维性 | ⭐⭐☆☆☆ 2/5 | 无监控、无告警、无日志持久化 |
| **综合** | **⭐⭐⭐☆☆ 2.4/5** | |

---

## 八、一句话结论

**功能可运行，但生产级运维能力严重不足——缺少进程守护、自动重启、开机自启三大核心能力。引入 pm2 + 创建桌面快捷方式 + 绑定 127.0.0.1 是最低成本的改进方案，预计 30 分钟内可完成。**

---

## 附录 A：改进前后对比

| 能力 | 改进前 | 改进后 |
|------|--------|--------|
| 进程守护 | ❌ 无 | ✅ pm2 管理 |
| 崩溃恢复 | ❌ 退出即挂 | ✅ 自动重启（最多 10 次） |
| 开机自启 | ❌ 手动 | ✅ pm2 startup |
| 日志管理 | ❌ 仅 console | ✅ pm2 日志文件 |
| 桌面入口 | ❌ 无 | ✅ 桌面快捷方式 |
| 健康就绪等待 | ❌ 盲等 3 秒 | ✅ 轮询 /health |
| 端口安全 | ⚠️ 0.0.0.0 | ✅ 127.0.0.1 |
| 优雅关闭 | ❌ 硬杀 | ✅ SIGTERM 处理 |

## 附录 B：执行优先级

```
优先级 1 (立即)   → pm2 部署 + 桌面快捷方式 + 绑定 127.0.0.1
优先级 2 (本周)   → 统一启动脚本 + 健康检查等待 + 优雅关闭
优先级 3 (后续)   → 日志轮转 + Windows 服务 + 自动更新脚本
```
