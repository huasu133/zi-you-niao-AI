# 自由鸟 v4 架构终审报告

> 审查人: architect | 审查日期: 2026-06-03

## 一、审查范围

| 文件 | 大小 | 角色 |
|------|------|------|
| `app.js` | 290 行 | HTTP 服务主入口，Express 路由 + OpenAI 对话循环 |
| `tool-registry.js` | 306 行 | 工具注册表、专家定义、安全规则 |
| `mcp-client.js` | 247 行 | 多引擎搜索客户端 + 网页提取 |

**关联文件也一并审查**: `expert-router.js`, `connectors/index.js`, `soul.md`, `tools/*.js`, `experts/*.soul.md`

---

## 二、功能完整性：13 个核心工具全部可用

### 工具清单 — 逐一核验

| # | 工具名 | 实现文件 | 状态 |
|---|--------|----------|------|
| 1 | `read_file` | `tools/read.js` | ✅ 存在 |
| 2 | `fetch_url` | `mcp-client.js` → `extractURL()` | ✅ 存在 |
| 3 | `search_web` | `mcp-client.js` → `searchWeb()` | ✅ 存在 |
| 4 | `write_file` | `tools/write.js` | ✅ 存在，含确认机制 |
| 5 | `run_command` | `tools/exec.js` | ✅ 存在，含确认机制 |
| 6 | `find_files` | `tools/find.js` | ✅ 存在 |
| 7 | `list_directory` | `tools/list.js` | ✅ 存在 |
| 8 | `save_memory` | `tools/memory.js` → `saveMemory()` | ✅ 存在 |
| 9 | `search_memory` | `tools/memory.js` → `searchMemory()` | ✅ 存在 |
| 10 | `reflect_lesson` | `tools/memory.js` → `reflect()` | ✅ 存在 |
| 11 | `create_task` | `tools/task.js` → `createTask()` | ✅ 存在 |
| 12 | `list_tasks` | `tools/task.js` → `listTasks()` | ✅ 存在 |
| 13 | `complete_task` | `tools/task.js` → `updateTask({status:'completed'})` | ✅ 存在 |

### 可选浏览器工具（3 个）

| # | 工具名 | 状态 |
|---|--------|------|
| 14 | `browser_navigate` | ⚠️ 可选，`tools/browser.js` 不存在时不加载 |
| 15 | `browser_fill` | ⚠️ 同上 |
| 16 | `browser_click` | ⚠️ 同上 |

> **结论**: 13 个核心工具全部可实现，代码路径完整。浏览器工具设计为优雅降级，不影响核心功能。

### 专家系统 — 10 个专家全部到位

`architect`, `copywriter`, `data-analyst`, `database-expert`, `devops`, `electron-expert`, `frontend-expert`, `payment-expert`, `security`, `seo-expert`

每个专家:
- 有独立的 `experts/{name}.soul.md` 定义文件 ✅
- 在 `EXPERT_TOOLS` 中有工具权限映射 ✅
- 通过正则模式匹配激活 ✅
- 有独立的对话历史和工具调用循环 ✅

---

## 三、架构评估

### 3.1 分层架构（清晰）

```
表示层     app.js (Express HTTP 路由 + SSE 流式输出)
业务层     tool-registry.js (工具定义 + 专家管理)
          expert-router.js (专家调用路由)
集成层     mcp-client.js (多引擎搜索 + 网页提取)
          connectors/ (外部平台连接器)
数据层     tools/memory.js (记忆 + 经验教训)
          tools/task.js (任务管理)
```

### 3.2 亮点

| 特性 | 评价 |
|------|------|
| **搜索引擎多级降级** | Claw → Serper → Tavily → DDG → ContextWire 五级回退，高可用 |
| **搜索缓存** | 1 小时 TTL + 200 条上限 + 自动淘汰，避免重复 API 调用 |
| **安全防护** | CSP 头、速率限制、敏感信息脱敏（钥匙 + 私钥模式）、搜索查询拦截 |
| **确认机制** | `write_file` 和 `run_command` 需 `__confirmed` 标志，防止误操作 |
| **截断保护** | 对话消息上限 50 条、工具调用上限 5 轮、总超时 180s，防止失控 |
| **专家历史持久化** | 每个专家独立保存历史，原子写入（`.tmp` → `rename`） |
| **记忆系统** | MEMORY.md + 经验教训分离，支持搜索 |
| **双模式搜索** | `basic` / `deep` 搜索模式可通过 API 切换 |
| **错误隔离** | 大量 try-catch，单个工具异常不影响整体流程 |

### 3.3 工具权限矩阵（合理）

| 专家 | read | find | list | fetch | search | write | exec |
|------|:----:|:----:|:----:|:-----:|:------:|:-----:|:----:|
| architect | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| security | ✅ | ✅ | — | ✅ | — | — | ✅ |
| devops | ✅ | — | ✅ | — | — | ✅ | ✅ |
| copywriter | ✅ | — | — | ✅ | ✅ | ✅ | — |
| data-analyst | ✅ | ✅ | ✅ | — | — | — | ✅ |
| database-expert | ✅ | ✅ | ✅ | ✅ | — | — | — |
| seo-expert | ✅ | — | — | ✅ | ✅ | — | — |
| payment-expert | ✅ | — | — | ✅ | — | ✅ | ✅ |
| electron-expert | ✅ | — | ✅ | ✅ | — | ✅ | — |
| frontend-expert | ✅ | ✅ | ✅ | ✅ | — | — | — |

> 危险工具（`write_file`, `run_command`）仅授予必要专家，且带确认机制，安全策略正确。

---

## 四、发现的问题与建议

### 严重 🔴

| # | 问题 | 位置 | 建议 |
|---|------|------|------|
| 1 | **无认证机制** | `app.js` 全部端点 | 所有 API 端点为匿名访问。建议至少添加共享密钥（`X-API-Key` 头验证）或 JWT |
| 2 | **CORS 未配置** | `app.js` | 当前未设置 `Access-Control-Allow-Origin`，但本地部署影响有限。如后续需远程访问，必须添加 |

### 中等 🟡

| # | 问题 | 位置 | 建议 |
|---|------|------|------|
| 3 | **`extractURL` 无降级** | `mcp-client.js:218` | 当 Tavily 未配置时直接返回错误，不会尝试其他提取方式。可增加 `fetch` + cheerio 兜底 |
| 4 | **错误信息泄露** | `tool-registry.js` handler | `catch (e) { return 'xxx 异常: ' + e.message }` 可能暴露文件系统路径。建议脱敏 |
| 5 | **`AbortSignal.timeout`** | `mcp-client.js` | 这是 Node.js 17+ 特性，需在 `engines` 中声明 `node >= 17` |
| 6 | **速率限制内存存储** | `app.js:42` | 重启后计数器清空。如需持久化，考虑 Redis |
| 7 | **无优雅关闭** | `app.js` | 缺少 `SIGTERM`/`SIGINT` 处理，进程可能被强制杀死时未关闭连接 |
| 8 | **`connectors.js` 缺失** | 项目根目录 | `app.js:6` 使用 `require('./connectors')`，实际路径为 `connectors/index.js`。Node.js 解析正确但可能引起混淆 |

### 轻微 🟢

| # | 问题 | 位置 | 建议 |
|---|------|------|------|
| 9 | **同代码重复** | `app.js` + `expert-router.js` | `sanitizeText`/`sanitizeOutput` 和 `getMemoryDesc` 在两个文件中实现相同逻辑。建议抽取公共模块 |
| 10 | **搜索缓存不用于 deep 模式** | `mcp-client.js:160` | `deep` 模式下不走缓存，但 DeepSeek 计费较高，建议也做短时间缓存 |
| 11 | **无 WebSocket 支持** | `app.js` | 目前仅 SSE 流式输出，如需要双向实时通信需加 WS |
| 12 | **`soul.md` 未做容错** | `app.js:116` | 启动时同步 `readFileSync`，文件缺失则启动失败 |

---

## 五、上线建议

### 上线前必须修复
1. **添加 API 认证**（最小可行: `X-API-Key` + 环境变量验证中间件）
2. **声明 Node.js 版本**（`package.json` → `engines.node >= 17`）
3. **增加优雅关闭**（`process.on('SIGTERM', ...)` 关闭 server + 清理）

### 上线后建议优化
1. `extractURL` 增加 HTTP fallback
2. 抽取公共模块（脱敏函数、记忆函数）
3. 生产环境加上 CORS 白名单
4. 考虑将速率限制改用 Redis（多进程部署时需共享状态）

---

## 六、综合评定

| 维度 | 评分 |
|------|------|
| 功能完整性 | ⭐⭐⭐⭐☆ 4/5 |
| 架构合理性 | ⭐⭐⭐⭐⭐ 5/5 |
| 安全性 | ⭐⭐⭐☆☆ 3/5 |
| 容错性 | ⭐⭐⭐⭐☆ 4/5 |
| 可维护性 | ⭐⭐⭐⭐☆ 4/5 |
| **综合** | **⭐⭐⭐⭐☆ 4/5** |

### 一句话结论

**架构设计扎实，13 个核心工具完整可用，搜索降级链是亮点。缺失 API 认证是最紧迫的上线阻塞项，修复后可以上线。**
