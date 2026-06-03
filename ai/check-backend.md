# 自由鸟 v4 后端完整性检查报告

> 生成时间: 2026-06-03
> 目标目录: `F:/ziyouniao/`

---

## 一、app.js — 路由端点检查

### 已实现端点

| 端点 | 方法 | 状态 | 说明 |
|------|------|------|------|
| `/health` | GET | ✅ | 健康检查，跳过 API Token 认证 |
| `/memory` | GET | ✅ | 获取当前记忆 |
| `/memory/search` | GET | ✅ | 搜索记忆 |
| `/experts` | GET | ✅ | 列出所有专家（非必需但有用） |
| `/tools` | GET | ✅ | 列出所有工具（非必需但有用） |
| `/tasks` | GET | ✅ | 列出任务（支持 filter 参数） |
| `/tasks` | POST | ✅ | 创建任务 |
| `/tasks/:id` | PATCH | ✅ | 更新任务状态 |
| `/connectors` | GET | ✅ | 连接器状态（非必需但有用） |
| `/api/config` | GET/POST | ✅ | 搜索模式配置 |
| `/chat` | POST | ✅ | **主聊天端点**，支持 SSE 流式输出，最多 5 轮工具调用 |

### ❌ 缺失端点

| 端点 | 问题 |
|------|------|
| `/browser` | **未实现**。浏览器工具（browser_navigate/fill/click）已注册为 LLM 工具，可通过 /chat 内的 function calling 使用，但没有独立的 REST 端点来直接控制浏览器。 |

### 中间件与安全

| 项目 | 状态 | 详情 |
|------|------|------|
| Node.js 版本检查 | ✅ | >= 18 |
| 全局异常处理 | ✅ | uncaughtException + unhandledRejection |
| 速率限制 | ✅ | 基于 IP+路径，每 60s 自动清理 |
| CSP 安全头 | ✅ | |
| API Token 认证 | ✅ | /health 豁免，其余需要 x-api-token |
| 输出脱敏 | ✅ | 7 种敏感信息模式匹配 |
| 输入长度限制 | ✅ | message 最长 10000 字符 |
| 优雅关闭 | ✅ | SIGTERM/SIGINT 处理 |

**结论**: 核心端点完整，仅 `/browser` 作为独立端点缺失（浏览器功能已作为 LLM 工具间接可用，影响不大）。

---

## 二、tool-registry.js — 工具定义与映射一致性

### 工具清单（基础 13 个）

| # | 工具名称 | 文件来源 | 状态 |
|---|----------|----------|------|
| 1 | `read_file` | tools/read.js | ✅ |
| 2 | `fetch_url` | mcp-client.js (extractURL) | ✅ |
| 3 | `search_web` | mcp-client.js (searchWeb) | ✅ |
| 4 | `write_file` | tools/write.js | ✅ |
| 5 | `run_command` | tools/exec.js | ✅ |
| 6 | `find_files` | tools/find.js | ✅ |
| 7 | `list_directory` | tools/list.js | ✅ |
| 8 | `save_memory` | tools/memory.js | ✅ |
| 9 | `search_memory` | tools/memory.js | ✅ |
| 10 | `reflect_lesson` | tools/memory.js | ✅ |
| 11 | `create_task` | tools/task.js | ✅ |
| 12 | `list_tasks` | tools/task.js | ✅ |
| 13 | `complete_task` | tools/task.js | ✅ |

### 可选浏览器工具（3 个，需 playwright 包）

| # | 工具名称 | 文件来源 | 状态 |
|---|----------|----------|------|
| 14 | `browser_navigate` | tools/browser.js | ✅ (条件加载) |
| 15 | `browser_fill` | tools/browser.js | ✅ (条件加载) |
| 16 | `browser_click` | tools/browser.js | ✅ (条件加载) |

**合计**: 基础 13 + 可选 3 = 最多 16 个工具 ✅

### EXPERT_TOOLS 映射检查

| 专家 | 允许工具 | 是否全部存在于 TOOLS | 
|------|----------|---------------------|
| architect | read_file, find_files, list_directory, fetch_url, search_web | ✅ |
| security | read_file, find_files, run_command, fetch_url | ✅ |
| devops | read_file, write_file, run_command, list_directory | ✅ |
| copywriter | read_file, write_file, fetch_url, search_web | ✅ |
| data-analyst | read_file, find_files, list_directory, run_command | ✅ |
| database-expert | read_file, find_files, list_directory, fetch_url | ✅ |
| seo-expert | read_file, fetch_url, search_web | ✅ |
| payment-expert | read_file, write_file, run_command, fetch_url | ✅ |
| electron-expert | read_file, write_file, list_directory, fetch_url | ✅ |
| frontend-expert | read_file, find_files, list_directory, fetch_url | ✅ |

### Experts 目录匹配

`./experts/` 目录下的 `.soul.md` 文件:
- architect.soul.md ✅
- copywriter.soul.md ✅
- data-analyst.soul.md ✅
- database-expert.soul.md ✅
- devops.soul.md ✅
- electron-expert.soul.md ✅
- frontend-expert.soul.md ✅
- payment-expert.soul.md ✅
- security.soul.md ✅
- seo-expert.soul.md ✅

**10 个专家 soul 文件与 EXPERT_TOOLS 的 10 个条目完全匹配** ✅

**结论**: 工具定义完整，EXPERT_TOOLS 映射与 TOOLS 注册一致，所有专家 soul 文件均存在。

---

## 三、mcp-client.js — 搜索降级链完整性

### 搜索提供者（5 个）

| 提供者 | 函数名 | 需要 API Key | 状态 |
|--------|--------|-------------|------|
| Claw Search | `clawSearch()` | 否 | ✅ 免费 |
| Serper.dev (Google) | `serperSearch()` | SERPER_API_KEY | ✅ |
| Tavily | `tavilySearch()` | TAVILY_API_KEY | ✅ |
| DuckDuckGo | `duckduckgoSearch()` | 否 | ✅ 免费 |
| ContextWire | `contextwireSearch()` | CONTEXTWIRE_API_KEY | ✅ |

### `searchWeb()` — 快速模式（basic）降级链

```
Claw Search → Serper → Tavily → DuckDuckGo → ContextWire
     ✅           ✅       ✅         ✅            ✅
```

5 层降级，均有 `.catch(() => [])` 保护 ✅

### `deepSearchWeb()` — 深度模式降级链

```
Tavily Deep → Serper → Claw → DuckDuckGo
     ✅          ✅      ✅        ✅
```

4 层降级 ✅

### `searchWeb()` — 深度模式（当 mode='deep' 且 TAVILY_KEY 存在）

直接使用 Tavily Deep，失败返回 error ✅

### 其他功能

| 功能 | 函数 | 依赖 | 状态 |
|------|------|------|------|
| URL 提取 | `extractURL()` | TAVILY_API_KEY | ✅ |
| 深度研究 | `research()` | TAVILY_API_KEY | ✅ |
| 查询脱敏 | `sanitizeQuery()` | 无 | ✅ |
| 搜索缓存 | `SEARCH_CACHE` | 无 (1h TTL) | ✅ |
| 模式切换 | `setSearchMode()` / `getSearchMode()` | 无 | ✅ |

### 安全措施

| 措施 | 状态 |
|------|------|
| 敏感信息拦截（API Key/Token） | ✅ 9 种模式 |
| 搜索缓存（basic 模式） | ✅ 1h TTL, 最大 200 条 |
| 单独超时控制 | ✅ 10s/15s |
| 空结果处理 | ✅ 每层返回 [] |

**结论**: 降级链完整，5 个搜索提供者覆盖，安全措施到位。

---

## 四、expert-router.js — 专家调度逻辑

### 调度流程

```
用户消息 → EXPERTS.find(patter匹配) → callExpert(专家, 消息, 历史)
                                              ↓
                                    加载专家历史 (JSON 文件)
                                              ↓
                                    构建 system prompt
                                    (soul + 用户记忆 + 安全规则 + 工具限制)
                                              ↓
                                    OpenAI API 调用 (deepseek-chat)
                                              ↓
                                    工具调用循环 (最多 3 轮)
                                              ↓
                                    保存专家历史 (原子写入)
                                              ↓
                                    脱敏输出 → 返回给用户
```

### 🔴 严重 Bug: `expertToolDefs` 未定义

**位置**: `expert-router.js:69`

```javascript
tools: expertToolDefs.map(t => ({ type: t.type, function: t.function }))
```

`expertToolDefs` 变量在文件中从未被定义。当 `callExpert` 执行到第 69 行时会抛出：
```
TypeError: Cannot read properties of undefined (reading 'map')
```

同样的问题出现在:
- `expert-router.js:79` — `expertToolDefs.find(...)`
- `expert-router.js:90` — `expertToolDefs.map(...)`
- `expert-router.js:98` — `expertToolDefs.find(...)`

**修复方案**:
```javascript
// 在 callExpert 函数内部，第 40 行附近添加：
const expertToolDefs = TOOLS.filter(t => expert.tools.includes(t.function.name))
```

### 其他观察

| 项目 | 状态 | 说明 |
|------|------|------|
| 专家历史持久化 | ✅ | `memory/experts/{role}.json` |
| 原子写入 | ✅ | 先写 .tmp 再 rename |
| 历史损坏恢复 | ✅ | try-catch 包裹 JSON.parse |
| 危险操作确认 | ✅ | write_file/run_command 需要 __confirmed |
| 输出脱敏 | ✅ | 8 种敏感模式 |
| 工具调用循环 | ✅ | 最多 3 轮，非流式 |
| 历史截断 | ✅ | 仅保留最近 30 条 |
| 用户记忆注入 | ✅ | loadMemory + loadLessons |
| OpenAI 实例缓存 | ✅ | 懒加载单例 |

### 与 app.js 调用的兼容性

app.js 中调用:
```javascript
const expertReply = await callExpert(requestedExpert, message, history)
```

但由于 `expertToolDefs` 未定义的问题，此调用在首次工具调用时会崩溃。

**结论**: 调度逻辑设计正确，但存在 **阻塞级 Bug**（`expertToolDefs` 未定义），导致专家模式无法正常使用工具。

---

## 五、connectors/index.js — 连接器加载

### 加载机制

```javascript
// 自动扫描同目录下的 .js 文件（排除 index.js）
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.js') && f !== 'index.js')
```

### 已加载连接器

| 连接器 | 文件 | 导出函数 | 状态 |
|--------|------|----------|------|
| github | connectors/github.js | listRepos, getFile, listIssues, createIssue, searchCode | ✅ |

### 连接器状态检查（app.js）

```javascript
app.get('/connectors', (req, res) => {
  // 仅检查 GITHUB_TOKEN 是否存在
  status[name] = mod.name === 'github' ? !!process.env.GITHUB_TOKEN : false
})
```

**结论**: 连接器加载机制正确，目前仅有 GitHub 连接器。扩展性好（自动扫描）。

---

## 六、tools/ 目录 — 工具文件完整度

### 文件清单

| 文件 | 导出函数 | tool-registry 引用 | 路径验证 | 敏感过滤 | 状态 |
|------|----------|-------------------|----------|----------|------|
| `tools/read.js` | readFile | ✅ | ✅ HOME 沙箱 | ✅ .ssh/.aws 等 | ✅ |
| `tools/write.js` | writeFile | ✅ | ✅ HOME 沙箱 | ✅ 敏感目录 | ✅ |
| `tools/exec.js` | runCommand | ✅ | 白名单模式 | ✅ 危险命令过滤 | ✅ |
| `tools/find.js` | findFiles | ✅ | ✅ HOME 沙箱 | ✅ 非法字符过滤 | ✅ |
| `tools/list.js` | listDir | ✅ | ✅ HOME 沙箱 | ✅ 敏感目录隐藏 | ✅ |
| `tools/memory.js` | saveMemory, searchMemory, reflect, loadMemory, loadLessons | ✅ | N/A | N/A | ✅ |
| `tools/task.js` | createTask, listTasks, updateTask | ✅ | N/A | N/A | ✅ |
| `tools/browser.js` | navigate, fill, click, screenshot, close | ✅ (条件) | N/A | N/A | ✅ |

### 安全性评分

| 工具 | 路径沙箱 | 命令过滤 | 文件大小限制 | 敏感路径过滤 | 确认机制 |
|------|----------|----------|-------------|-------------|----------|
| read_file | ✅ | N/A | ✅ 10MB | ✅ 6 类 | N/A |
| write_file | ✅ | N/A | N/A | ✅ 8 类 | ✅ |
| run_command | N/A | ✅ 白名单+黑名单 | N/A | N/A | ✅ |
| find_files | ✅ | N/A | N/A | ✅ | N/A |
| list_directory | ✅ | N/A | N/A | ✅ 6 类 | N/A |

**结论**: 所有 8 个工具文件均存在，功能与 tool-registry.js 注册一致。安全措施覆盖全面。

---

## 总结

### ✅ 通过项（5 项）

1. **app.js 路由**: 核心端点全部实现，安全中间件完整
2. **tool-registry 工具**: 13+3 个工具全部正确定义和注册
3. **mcp-client 降级链**: 5 个搜索提供者，多层降级，安全措施到位
4. **connectors 加载**: 自动扫描机制正确
5. **tools/ 目录**: 8 个工具文件齐全，功能匹配，安全措施好

### ⚠️ 待改进（1 项）

| 问题 | 位置 | 严重度 |
|------|------|--------|
| `/browser` 端点缺失 | app.js | 低 — 浏览器工具已通过 /chat 可用 |

### 🔴 必须修复（1 项）

| Bug | 位置 | 严重度 |
|-----|------|--------|
| `expertToolDefs` 未定义 | expert-router.js:69,79,90,98 | **严重** — 专家模式工具调用会崩溃 |

**修复方法**: 在 `callExpert` 函数开头（约第 40 行）添加：
```javascript
const expertToolDefs = TOOLS.filter(t => expert.tools.includes(t.function.name))
```

---

### 整体评估

后端架构设计合理，模块化良好，安全措施到位（路径沙箱、命令白名单、敏感过滤、脱敏输出）。

**唯一阻塞问题**: `expert-router.js` 中 `expertToolDefs` 变量未定义，导致所有专家模式的工具调用都会崩溃。修复此问题后，后端即可完整运行。
