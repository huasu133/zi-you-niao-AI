# 自由鸟 v4 最终安全检查 — 安全配置审查

**审查人**: security-config  
**日期**: 2026-06-03  
**范围**: F:/ziyouniao/ 全部源文件及配置

---

## 1. .env 文件检查

**状态**: 发现 **2 个严重问题**

| 项目 | 状态 | 说明 |
|------|------|------|
| .env 在 .gitignore 中 | ✅ 通过 | `.gitignore` 第 1 行包含 `.env` |
| .env 未被 Git 追踪 | ✅ 通过 | `git ls-files .env` 返回空 |
| DEEPSEEK_API_KEY | ✅ 安全 | 值为占位符 `你的Key` |
| GITHUB_TOKEN | ✅ 安全 | 值为占位符 `你的Token` |
| **SERPER_API_KEY** | 🔴 严重 | 包含真实密钥 `0d41d475471323f87c675f50e8085d7ef58f60bd` |
| **TAVILY_API_KEY** | 🔴 严重 | 包含真实密钥 `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` |
| CONTEXTWIRE_API_KEY | ✅ 安全 | 空值 |
| PORT | ✅ 信息 | 3456 |
| **API_TOKEN** | 🟡 中等 | 硬编码 `ziyouniao-local`，但仅本地使用 |

**建议**: 如果需要交付此项目给他人或开源，立即轮换 SERPER 和 TAVILY 密钥。当前 .gitignore 已正确排除 .env，密钥不会泄露到 Git 仓库。

---

## 2. .gitignore 配置检查

**状态**: 🟡 基本通过，有 2 个缺失项

### 当前 .gitignore 内容
```
.env
node_modules/
tasks.json
memory/
*.png
.DS_Store
```

### 缺少的项目

| 缺失项 | 严重程度 | 说明 |
|--------|----------|------|
| **`dist/`** | 🟡 中等 | `package.json` build.output 为 `dist`，但未忽略构建产物 |
| **`chromadb/`** | 🟡 中等 | ChromaDB 持久化数据目录未忽略（当前不存在但应预设） |
| `memory.db` | ✅ 已覆盖 | `memory/` 目录规则已包含 memory 下的所有文件 |

### 已验证未被追踪的文件
- `memory/memory.db` — 未被 Git 追踪 ✅
- `.env` — 未被 Git 追踪 ✅

**建议**: 在 .gitignore 中添加 `dist/` 和 `chromadb/`。

---

## 3. package.json 安全性检查

**状态**: ✅ 通过

### 敏感信息检查
- 无硬编码密钥、Token 或密码
- `license` 字段为 `"MIT"`（安全）
- `build.files` 白名单中不包含 `.env` ✅

### 依赖安全检查

| 类别 | 结果 |
|------|------|
| 生产依赖 (npm audit --production) | 0 个漏洞 |
| 开发依赖 (electron-builder 链) | 多个 HIGH 级别漏洞（非运行时，仅构建工具链） |

**开发依赖漏洞详情**（均为传递依赖，来自 electron-builder）:
- `@electron/rebuild` (3.2.10-4.0.2) — 通过 tar/node-gyp
- `app-builder-lib` (23.0.7-26.5.0) — 通过 tar
- `cacache` (14.0.0-18.0.4) — 通过 tar
- `electron` — GitHub Advisory 1107272

**修复方案**: 升级 `electron-builder` 到 `^26.8.1` 可解决大部分问题。

---

## 4. app.js 安全配置检查

**状态**: 🟡 基本通过，有 4 个需要注意的问题

### API Token 认证（第 88-95 行）

```js
const API_TOKEN = process.env.API_TOKEN || 'ziyouniao-local'  // 🟡 第 89 行
app.use((req, res, next) => {
  if (req.path === '/health') return next()
  const token = req.headers['x-api-token']
  if (token !== API_TOKEN) return res.status(401).json({ error: '未授权' })
  next()
})
```

| 项目 | 状态 | 说明 |
|------|------|------|
| 认证中间件 | ✅ 存在 | 所有端点（除 /health）都需要 x-api-token |
| 健康检查豁免 | ✅ 合理 | /health 用于轮询，无需认证 |
| **硬编码回退值** | 🟡 问题 | 当未设置 `API_TOKEN` 环境变量时使用 `ziyouniao-local` |
| **字符串比较** | 🟡 问题 | 使用 `!==` 简单对比，建议使用 `crypto.timingSafeEqual` 防时序攻击 |

### 速率限制（第 49-86 行）

| 项目 | 状态 | 说明 |
|------|------|------|
| 速率限制存在 | ✅ 已实现 | 按 IP+路径 在内存 Map 中追踪 |
| 端点分级限制 | ✅ 合理 | /health:60, /chat:30, /tasks:15, /api/config:10 |
| 内存清理 | ✅ 有 | 每 60 秒清理过期记录，上限 5000 条 |
| **IP 来源** | 🟡 问题 | `req.ip` 可被 X-Forwarded-For 头欺骗，应配置 `trust proxy` |

### 安全响应头（第 72-77 行）

| 头部 | 值 | 状态 |
|------|-----|------|
| Content-Security-Policy | `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'` | 🟡 `unsafe-inline` 允许内联脚本 |
| X-Content-Type-Options | `nosniff` | ✅ 良好 |
| X-Frame-Options | `DENY` | ✅ 良好 |
| Referrer-Policy | `no-referrer` | ✅ 良好 |
| Permissions-Policy | `geolocation=(), microphone=(), camera=()` | ✅ 良好 |
| **缺少 HSTS** | — | 🟡 本地应用不需要，但若远程部署应添加 `Strict-Transport-Security` |

### 服务器绑定（第 295 行）

```js
const server = app.listen(PORT, '0.0.0.0', ...)  // 🔴 第 295 行
```

| 问题 | 严重程度 | 说明 |
|------|----------|------|
| **绑定到 0.0.0.0** | 🔴 严重 | 监听所有网络接口，局域网内任何设备可访问 |
| 端口 | 🟡 信息 | `3456`，非特权端口 |

### 输入验证

| 项目 | 状态 |
|------|------|
| Body 大小限制 | ✅ `express.json({ limit: '1mb' })` |
| 消息长度检查 | ✅ `/chat` 端点限制 10000 字符 |
| 搜索模式白名单 | ✅ 仅允许 `basic`/`deep` |
| 输出脱敏 | ✅ `sanitizeText()` 过滤 API Key 模式 |

### 其他

| 项目 | 状态 | 说明 |
|------|------|------|
| 全局异常处理 | ✅ 有 | uncaughtException + unhandledRejection |
| 优雅关闭 | ✅ 有 | SIGTERM/SIGINT 处理 |
| 工具调用最大轮次 | ✅ 5 轮上限 |
| 总请求超时 | ✅ 180 秒 |
| 聊天历史截断 | ✅ 50 条消息上限 |
| **CSP 'unsafe-inline'** | 🟡 | 内联脚本和样式允许 XSS 风险（虽为桌面应用） |

---

## 5. 硬编码密钥扫描

**状态**: 🔴 发现 1 个严重问题

### 源文件扫描结果

| 文件 | 状态 | 详情 |
|------|------|------|
| `app.js` | 🟡 | 第 89 行：API_TOKEN 硬编码回退值 |
| `mcp-client.js` | ✅ | 所有密钥从 `process.env` 读取 |
| `expert-router.js` | ✅ | 所有密钥从 `process.env` 读取 |
| `connectors/github.js` | ✅ | Token 从 `process.env` 读取 |
| `tools/*.js` | ✅ | 无硬编码密钥 |
| **`public/index.html`** | 🔴 **严重** | **第 140 行：硬编码 API_TOKEN** |

### index.html 第 140 行

```js
const API_TOKEN = 'ziyouniao-local'  // 🔴 严重：前端明文硬编码
```

这是一个严重问题——前端 JavaScript 中以明文形式暴露了 API Token。虽然这只是一个本地应用，但如果页面被远程访问（0.0.0.0 绑定），局域网内的攻击者可以直接读取页面源码获取 Token。

---

## 6. Electron/Chromium 安全配置

**状态**: ✅ 基本安全，有 2 个建议

### electron-main.js 检查

| 配置项 | 值 | 状态 |
|--------|-----|------|
| `nodeIntegration` | `false` | ✅ 安全 |
| `contextIsolation` | `true` | ✅ 安全 |
| 窗口打开处理 | `setWindowOpenHandler` + `action: 'deny'` | ✅ 安全 |
| 外部链接 | 通过 `shell.openExternal` 在系统浏览器打开 | ✅ 安全 |
| 服务器进程 | 通过 `fork()` 隔离 | ✅ 良好 |

### 缺少的安全配置

| 缺失项 | 严重程度 | 建议 |
|--------|----------|------|
| **`sandbox: true`** | 🟡 中等 | 未显式启用沙箱模式，建议添加 `sandbox: true` 到 webPreferences |
| **`webSecurity: true`** | 🟡 低 | 默认为 true，但建议显式声明 |
| **CSP via meta/session** | 🟡 低 | 未在 BrowserWindow 中设置 `session.defaultSession.webRequest` 策略 |

### 建议添加到 electron-main.js 的配置:

```js
webPreferences: {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,           // 添加
  webSecurity: true,       // 显式声明
},
```

---

## 7. 端口/服务暴露检查

**状态**: 🟡 需要关注

| 项目 | 状态 | 说明 |
|------|------|------|
| 端口 | 🟡 | 3456（非标准端口，减少扫描风险） |
| 绑定地址 | 🔴 | `0.0.0.0` — 暴露给所有网络接口 |
| 认证保护 | 🟡 | API Token 认证存在但 Token 硬编码在前端 |
| HTTPS | ❌ 无 | 纯 HTTP，无加密传输 |
| 生产依赖端口 | 0 个漏洞 | 安全 |

---

## 问题汇总

### 🔴 严重 (需立即修复)

| # | 问题 | 位置 | 修复方案 |
|---|------|------|----------|
| 1 | **真实 API 密钥在 .env 中** | `.env` 第 6-7 行 | 轮换 SERPER 和 TAVILY 密钥；确认 .env 永不提交 |
| 2 | **API_TOKEN 硬编码在前端 JS** | `public/index.html` 第 140 行 | 删除前端的 `const API_TOKEN`，让用户在 UI 中输入；或从后端安全获取 |
| 3 | **服务器绑定 0.0.0.0** | `app.js` 第 295 行 | 改为 `127.0.0.1` 或 `::1`（仅本地），除非明确需要局域网访问 |

### 🟡 中等 (应尽快修复)

| # | 问题 | 位置 | 修复方案 |
|---|------|------|----------|
| 4 | .gitignore 缺少 `dist/` | `.gitignore` | 添加 `dist/` |
| 5 | .gitignore 缺少 `chromadb/` | `.gitignore` | 添加 `chromadb/` |
| 6 | API_TOKEN 硬编码回退值 | `app.js` 第 89 行 | 移除默认值，未设置环境变量时拒绝启动 |
| 7 | Electron 缺少 `sandbox: true` | `electron-main.js` 第 30 行 | 添加 `sandbox: true` |
| 8 | 开发依赖存在 HIGH 漏洞 | `package.json` | 升级 electron-builder 到 ^26.8.1 |

### 🟢 建议 (可选改进)

| # | 建议 | 位置 | 说明 |
|---|------|------|------|
| 9 | `crypto.timingSafeEqual` | `app.js` 第 93 行 | 防时序攻击，增强 Token 比较安全性 |
| 10 | 配置 `trust proxy` | `app.js` | 防止 IP 伪造绕过多速率限制 |
| 11 | 添加 HSTS 头 | `app.js` 第 73 行 | 若未来远程部署 |
| 12 | 迁移 `unsafe-inline` CSP | `app.js` 第 73 行 | 使用 nonce 或 hash 替代 unsafe-inline |
| 13 | 显式 `webSecurity: true` | `electron-main.js` | 防御性编程 |

---

## 总体评估

**安全等级**: 🟡 **中等偏上**

项目的安全措施基本到位（有认证、速率限制、安全头、输出脱敏），但存在 3 个需要立即修复的严重问题：

1. **真实 API 密钥**在 .env 文件中（虽未被 Git 追踪，但本地泄露风险）
2. **前端硬编码 API Token** — 如果 0.0.0.0 绑定被利用，攻击者可获取认证凭据
3. **0.0.0.0 绑定** — 将服务暴露给整个局域网

核心风险在于：**0.0.0.0 + 前端硬编码 Token = 局域网内无需认证即可访问**。虽然 `/health` 之外的端点都需要 x-api-token，但 Token 就在页面源码中明文可读，任何能访问该 IP 的人都可以轻易绕过认证。

**修复优先级**: 先改绑定地址 → 再修复前端 Token → 最后轮换 .env 中的密钥。
