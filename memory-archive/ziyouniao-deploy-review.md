# 自由鸟 v4 — 部署审查报告

> 审查日期：2026-05-29 | 目标环境：Windows WSL2 / 原生 macOS

---

## 一、部署架构总览

```
用户浏览器 ──→ localhost:3456
                  ↓
            Express 服务器
            ├── 静态文件 (public/)
            ├── /chat (SSE 流式)
            ├── /connectors (状态)
            └── /tasks (任务管理)
                  ↓
            外部 API
            ├── DeepSeek API (AI 推理)
            ├── DuckDuckGo (搜索，零依赖)
            ├── Tavily API (搜索备选，可选 Key)
            └── ContextWire (搜索备选，可选 Key)
```

---

## 二、部署到 VPS 的问题

当前方案明确写「本地自用台式机」，但如果你**以后想部署到 VPS 上**，有几个必须要改的地方：

### ❌ 没有身份认证 — 部署到公网就会裸奔

方案绑定了 `127.0.0.1`，外网访问不了。但如果绑定 `0.0.0.0`，任何人都能调用你的 AI。

**建议：如果上 VPS，至少加一个简单的 Token 认证。**
```javascript
// app.js 加一行中间件
app.use('/api', (req, res, next) => {
  if (req.headers['x-api-token'] !== process.env.API_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
})
```

### ❌ 没有进程守护 — 进程挂了就没了

`node app.js` 一关终端就停。本地可以接受，但 VPS 上不行。

**建议：用 PM2 管理进程**
```bash
npm install -g pm2
pm2 start app.js --name ziyouniao
pm2 save
pm2 startup  # 开机自启
```

### ❌ 没有日志轮转

Express 日志和错误输出到 stdout，没有文件记录。出问题没法排查。

**建议：PM2 日志 + 错误日志文件**
```bash
pm2 start app.js --name ziyouniao --log ./logs/app.log --error ./logs/error.log
```

---

## 三、本地部署问题

### 1️⃣ Node.js 版本兼容性

文档要求 Node >= 18，但代码中用了：
- `fetch()` — Node 18+ 原生支持 ✅
- `AbortSignal.timeout()` — Node 18+ ✅
- `fs/promises` — Node 14+ ✅
- 动态 `import()` — Node 18+ ✅

**没问题，Node 20 LTS 完全兼容。**

### 2️⃣ Windows 兼容性

文档说「Windows WSL2 或原生」，但有几个地方对 Windows 不友好：

| 问题 | 位置 | 影响 |
|------|------|------|
| `path.resolve(homedir, ...)` | 多个工具 | macOS/Linux 的 `~/` 在 Windows 上不是家目录 |
| `SENSITIVE_PATTERNS` 含 `/etc/passwd` | read.js | Windows 没有这些文件，不影响功能 |
| `exec.js` 用 `find` 命令 | find.js | Windows 上没有 `find` 命令，只能用 `dir`（已有处理 ✅）|

**Windows 建议：直接用 WSL2 部署，避免原生 Windows 的路径差异问题。**

### 3️⃣ 环境变量加载

文档让手动 `echo` 写入 `.env`，但运行时不加载 `.env`。方案中用了 `dotenv` 包，但 `app.js` 中没有看到 `require('dotenv').config()`。

**需要确认：** `app.js` 启动时是否调用了 `dotenv.config()`。

### 4️⃣ 端口占用

默认使用 `3456` 端口。如果本地已经有什么服务占了就会报错。

**建议：`app.js` 加端口 fallback 逻辑**
```javascript
const PORT = process.env.PORT || 3456
app.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 自由鸟已启动: http://127.0.0.1:${PORT}`)
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ 端口 ${PORT} 已被占用，请改 PORT 环境变量`)
  }
})
```

---

## 四、外部依赖的部署注意事项

### DeepSeek API
- **需要网络** — 本地断网就不能用了
- **费用** — 按 token 计费，不是免费的
- **Fallback** — 没有备选模型，DeepSeek 挂了整个 AI 就停了
- **建议** — 如果 DeepSeek 超时，在 `.env` 准备一个备选 API Key

### Tavily / ContextWire
- 没配 Key 降级到 DuckDuckGo，不影响基本功能 ✅
- 但如果同时用 `extractURL` 和 `research`，需要 Key

### DuckDuckGo
- 唯一零依赖的搜索源
- **问题：** 被 DDG 限流后，搜索结果全是空的，没有提示用户
- **建议：** 返回结果时加个 `warning` 字段，如果 DDG 返回空但没报错，提示「搜索可能被限流」

---

## 五、部署验收清单

```
□ 启动：node app.js 无报错
□ 访问：http://localhost:3456 显示 Web UI
□ 聊天：发送消息能收到 AI 回复
□ 搜索：问"搜一下今天天气"能返回搜索结果
□ 读文件：问"读一下 package.json"能显示内容
□ 写文件：问"创建一个 test.txt"触发确认对话框
□ 重启：Ctrl+C 后重新启动，记忆还在
□ 断网：断网重连后功能恢复
```

---

## 六、建议

1. **启动脚本** — `package.json` 中加 `"start": "node -r dotenv/config app.js"`，确保 .env 自动加载
2. **Node 版本检查** — 启动时检查 `process.version`，如果低于 18 给出明确的错误提示
3. **日志文件** — 至少把启动日志写到文件，方便出问题排查
4. **健康检查** — 加一个 `/health` 端点，返回服务器状态和各 API 连通性
