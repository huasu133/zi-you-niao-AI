# 自由鸟 v4 开发任务清单

## 规格摘要
**原始需求**: 自托管 AI 助手，Node.js + Express + DeepSeek API，本地台式机运行
**技术栈**: Node.js 20+ / Express 4 / DeepSeek API / 原生 HTML+CSS+JS
**目标环境**: Windows 原生 / WSL2
**产出目录**: F:/ziyouniao/
**工期**: 3 阶段，约 7 小时

---

## 前置任务：专家审查（先于编码）

| # | 任务 | 负责 | 审查内容 |
|---|------|------|------|
| P0 | 安全专家审查方案 | 🛡️ 安全专家 | 12 项安全防护是否到位、有无遗漏攻击面 |
| P1 | Node.js 专家审查方案 | ⚡ Node 专家 | 异步处理、内存泄漏、错误边界、性能瓶颈 |
| P2 | 前端专家审查方案 | 🎨 前端专家 | Web UI 交互体验、响应式设计、CSS 改进 |

---

## Phase 1 — 核心跑通（P0，目标 3h）

### [ ] 任务 1: 项目初始化
**描述**: 创建 package.json、安装依赖、配置 .env
**验收标准**:
- `npm install` 无报错
- .env 文件含 DEEPSEEK_API_KEY
- .gitignore 排除 .env、node_modules、memory/

**文件**:
- F:/ziyouniao/package.json
- F:/ziyouniao/.env
- F:/ziyouniao/.gitignore
- F:/ziyouniao/.nvmrc

**依赖**: `express openai dotenv`
**参考**: Step 1 全部

---

### [ ] 任务 2: 核心工具（read/write/exec/find/list）
**描述**: 按方案代码创建 5 个核心工具文件
**验收标准**:
- read.js: safeResolve + 敏感文件黑名单 + 10MB 上限
- write.js: symlink 检测 + SENSITIVE 目录拦截
- exec.js: 白名单 + SHELL_BLOCKED 正则 + 30s 超时
- find.js: pattern 转义 + Windows dir 兼容
- list.js: 路径安全 + 目录优先排序

**文件**:
- F:/ziyouniao/tools/read.js
- F:/ziyouniao/tools/write.js
- F:/ziyouniao/tools/exec.js
- F:/ziyouniao/tools/find.js
- F:/ziyouniao/tools/list.js

**参考**: Step 2 — tools/*.js 五个文件全部

---

### [ ] 任务 3: tool-registry.js
**描述**: 工具注册表（FC schema + handler + 专家权限表 + SAFETY_RULES）
**验收标准**:
- 注册所有 7 个工具（含 save_memory/search_memory/reflect_lesson 预留）
- write_file/run_command 含 __confirmed 检查
- EXPERT_TOOLS 权限表完整
- 浏览器工具 try-catch 可选加载

**文件**: F:/ziyouniao/tool-registry.js
**参考**: Step 3 — tool-registry.js 完整代码

---

### [ ] 任务 4: app.js
**描述**: Express 服务器 + 中间件 + 路由 + SSE 流
**验收标准**:
- dotenv 在最顶部加载
- 安全头（CSP/X-Content-Type-Options/X-Frame-Options/Referrer-Policy/Permissions-Policy）
- 速率限制（/health 60次/分，/chat 30次/分）
- /chat 端点 SSE 流式输出 + 多轮 tool call（最多 5 轮）
- 全局 uncaughtException/unhandledRejection
- 绑定 127.0.0.1:3456

**文件**: F:/ziyouniao/app.js
**参考**: Step 3 — app.js 完整代码

---

### [ ] 任务 5: Web UI 基础版
**描述**: 聊天界面 + 确认对话框
**验收标准**:
- 聊天窗口可发送消息并显示 AI 回复
- 确认对话框可弹出（允许/拒绝）
- 消息带 HH:MM 时间戳
- 发送按钮 disabled 状态有视觉反馈
- 历史消息保留（不清空）

**文件**: F:/ziyouniao/public/index.html
**参考**: Step 4 — public/index.html（可先只做聊天区，导航栏后续加）

---

### [ ] 任务 6: 首次启动验证
**描述**: 启动服务器，发送消息验证功能
**验收标准**:
- `node app.js` 启动无报错
- 浏览器 http://localhost:3456 显示 UI
- 发送"你好"得到 AI 回复
- 无 system prompt 加载错误

**验证点**: Phase 1 完成

---

## Phase 2 — 搜索 + 记忆（P0-P1，目标 2h）

### [ ] 任务 7: mcp-client.js
**描述**: 搜索客户端（Claw → Serper → Tavily → DDG → ContextWire）
**验收标准**:
- Claw Search 零配置主搜
- DDG 兜底（3 种 HTML 匹配模式）
- Serper/Tavily 按需启用（有 Key 才加载）
- 搜索查询脱敏（8 种敏感模式）
- 缓存 1 小时（basic 模式）
- setSearchMode/getSearchMode 双模式切换

**文件**: F:/ziyouniao/mcp-client.js
**参考**: Step 2 — mcp-client.js 完整代码

---

### [ ] 任务 8: memory.js + task.js
**描述**: 记忆系统 + LESSONS.md 反思 + 任务管理
**验收标准**:
- saveMemory: 替换式更新 + 同步写日志
- searchMemory: 搜 MEMORY.md + 所有日志
- reflect_lesson: 记录经验教训到 LESSONS.md
- loadLessons: RAG 式加载到系统 prompt
- createTask/listTasks/updateTask: 完整 CRUD

**文件**:
- F:/ziyouniao/tools/memory.js
- F:/ziyouniao/tools/task.js

**参考**: Step 2 — memory.js + task.js

---

### [ ] 任务 9: 搜索+记忆接入 tool-registry
**描述**: 在 tool-registry.js 中添加搜索和记忆工具
**验收标准**:
- search_web 工具注册（调用 mcp-client searchWeb）
- fetch_url 工具注册（调用 mcp-client extractURL）
- save_memory / search_memory / reflect_lesson 注册
- create_task / list_tasks / complete_task 注册

**文件**: F:/ziyouniao/tool-registry.js（更新）

---

### [ ] 任务 10: Phase 2 验证
**描述**: 重启服务器，验证搜索和记忆
**验收标准**:
- 搜"Node.js 最新版本"返回结果
- 说"记住我最喜欢的颜色是蓝色"，重启后能回忆
- 搜同一关键词第二次走缓存
- 说"创建一个任务测试搜索"，任务列表里有

---

## Phase 3 — 进阶功能（P2-P3，目标 2h）

### [ ] 任务 11: expert-router.js + soul.md
**描述**: 专家路由（独立上下文 + 独立工具）+ 总控身份
**验收标准**:
- expert-router 支持独立 OpenAI 调用 + 专属工具
- soul.md 定义总控人格（方案内完整模板）
- experts/ 目录含 10 个专家定义文件
- 在聊天中说"叫架构师"触发专家切换

**文件**:
- F:/ziyouniao/expert-router.js
- F:/ziyouniao/soul.md
- F:/ziyouniao/experts/*.soul.md（10 个）

**参考**: Step 3 — expert-router.js + Step 5 — soul.md + 专家模板

---

### [ ] 任务 12: Web UI 完善
**描述**: 导航栏 + 连接器面板 + 专家列表 + 记忆查看 + 任务管理 + 设置
**验收标准**:
- 左侧导航 6 个 Tab 全切换正常
- 连接器面板显示 GitHub 状态
- 专家列表显示可用专家
- 记忆 Tab 显示 MEMORY.md 内容
- 任务 Tab 支持创建/筛选/完成
- 设置面板显示搜索模式切换 + GitHub 状态

**文件**: F:/ziyouniao/public/index.html（更新）

---

### [ ] 任务 13: connectors（GitHub）
**描述**: GitHub 连接器（可选）
**验收标准**:
- connectors/index.js 自动加载
- connectors/github.js 支持 listRepos/getFile/listIssues/searchCode
- 未配 Token 时返回友好提示

**文件**:
- F:/ziyouniao/connectors/index.js
- F:/ziyouniao/connectors/github.js

---

### [ ] 任务 14: 全线集成测试
**描述**: 完整功能验收
**验收标准**:
- ✅ 聊天 + tool call 正常
- ✅ 搜索 6 层链路逐层回退
- ✅ 记忆读写持久化
- ✅ 任务 CRUD
- ✅ 专家路由切换
- ✅ 连接器状态轮询
- ✅ 确认对话框工作
- ✅ 重启后记忆不丢失

---

## 质量要求
- [ ] 所有工具文件遵循方案中的安全基线
- [ ] app.js 绑定 127.0.0.1（不暴露公网）
- [ ] 输出脱敏覆盖所有 8 种模式
- [ ] 错误信息不泄露文件路径/env 变量名
- [ ] 写文件/执行命令走 __confirmed 代码级确认
- [ ] Node.js >= 18 版本检查

## 技术备注
**开发环境**: Windows 原生 / WSL2
**产出目录**: F:/ziyouniao/
**API 依赖**: DeepSeek API（必须）、Serper/Tavily（可选）
**搜索兜底**: DuckDuckGo 零依赖
**无上游风险**: 仅 express + openai 两个外部依赖

## 风险提醒
| 风险 | 缓解 |
|------|------|
| DeepSeek API 超时 | 前端 60s AbortController 超时 |
| DDG 限流 | Serper/Tavily 备选 |
| Windows 路径差异 | 方案已做 path.resolve + isWithin 兼容 |
| 记忆文件膨胀 | 后续加归档（当前不阻塞） |
