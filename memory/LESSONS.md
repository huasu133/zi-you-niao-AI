# 经验教训

记录 AI 从错误中总结的经验，供后续参考。

## 2026-06-04 全面审计修复
- P0-1: `__confirmed` 可被LLM注入绕过 → 改用服务器端确权，强制 `delete args.__confirmed`，LLM无法伪造确认
- P0-2: API Token 拼接 HTML 未转义 → 加 `escapeJS()` 防 XSS + 启动缓存替代每次读磁盘
- P1-5: 工具执行结果可能泄漏 API Key → 加 `sanitizeOutput()` 统一正则脱敏
- P1-6: writeFileSync 阻塞事件循环 → 改用 `fs.promises.writeFile` 异步写入
- P1-7: LLM 多轮调用无超时 → 加 30s Promise.race 超时
- P2-8: 导入但未使用的 3 个变量 → 清理 `EXPERTS`、`TEAM_DESC`、`EXPERT_TOOLS`
- P2-10: `req.setTimeout` 无 handler → 加 handler 主动销毁超时连接

## 界面改造
- 多任务功能：新建/切换/删除会话，每个任务独立历史
- 底部工具栏：模型选择（DeepSeek-V4-Pro / V4-Flash）+ 搜索模式（快速/深度）
- 绑定地址从 0.0.0.0 改为 127.0.0.1

## 架构与工程
- 绑定 localhost（127.0.0.1）防止任何远程访问
- 安全审计 11 项共修 9 项，2 项不修（本地不需要）

## DevOps
- 无进程守护（pm2）导致崩溃退出后无自动重启
- 缺失 SIGTERM/SIGINT 优雅关闭处理
- 两套启动脚本（.vbs + .bat）功能重叠未统一维护
- 硬编码 3 秒 wait 等待服务启动不可靠应轮询 /health
- Edge 浏览器路径硬编码仅 x86 版本
- 端口变更需同步修改 .env/.vbs/.bat 三处
- 无日志持久化机制（console.log 不写入文件）
- 临时文件和测试构建产物未清理占用磁盘空间
- electron-builder 沙箱中签名失败，用 npx electron . 代替

## Prompt
- getMemoryDesc 中 reflect_lesson 使用指令在记忆非空后永久消失
- soul.md 通篇未提及 reflect_lesson 工具
- loadLessons 全量注入无过滤导致 RAG 退化为上下文膨胀
- SAFETY_RULES 7 条平铺无优先级分层
- soul.md "工具箱"与 tool-registry.js JSON Schema 重复冗余
- 记忆和教训无限注入 system prompt 随时间推移挤压有用上下文
- soul.md 缺少工具决策优先级框架和 Chain-of-Thought 触发
- __confirmed 确认机制导致每次危险操作多消耗一轮 API 调用
- 专家路由 getMemoryDesc 与主版行为不一致（缺少反思提醒）
- reflect 正则替换无 g 标志同类多次反思旧条目残留

## 专家调度
- expertToolDefs 变量未定义导致专家模式所有工具调用崩溃
- 专家模式直接调 tool.handler(args) 不额外检查 __confirmed
- OpenAI 实例在 app.js 和 expert-router.js 重复创建
- getMemoryDesc 在两个文件中重复定义且行为不一致
- 专家链式 tool call 无超时保护
- 专家 finalContent 可能为空返回空白给用户
- 专家历史 JSON.parse 异常被静默吞掉不告警
- tool call ID 可能冲突无校验

## 内存
- saveMemory 的 read-then-write 并发写入存在数据丢失
- reflect 函数同样存在 read-then-write 竞态
- loadMemory 在每次请求中同步读取 MEMORY.md 成为性能瓶颈
- 缓存用 mtime 检测变更不可靠（FAT32 精度仅 2 秒）
- MEMORY.md 无界增长无大小上限和归档策略
- searchMemory 全量扫描所有每日日志文件 O(N) 无索引
- LESSONS.md 纯文本无结构化存储不支持按类别检索
- 错误被静默吞噬（catch (_) {} 不记录日志）
- task.js 混用同步 I/O 与 memory.js 异步不一致

## 前端
- api() 函数返回自己而非 fetch() 导致无限递归
- TextDecoder 不加 {stream:true} 中文 UTF-8 被分片时出现乱码
- innerHTML 拼接用户输入必须先用 escapeHtml 转义防 XSS
- 任务 ID 拼入 onclick 属性时单引号会破坏 JS 语法，应用 data-* 属性
- toast() 被调用但未定义抛出 ReferenceError
- history 数组只存 assistant 消息缺少 user 消息导致多轮对话上下文不完整
- SSE 流式输出不自动滚动到底部，长回复时用户需手动滚屏
- 确认对话框不支持 Escape 关闭和 Enter 确认
- 点击 overlay 遮罩不关闭对话框
- CSS 颜色硬编码无 CSS 变量，改主题需逐行替换
- font-family 缺少 Windows 字体回退（Microsoft YaHei）
- 缺少 <meta viewport> 导致移动端完全不可用
- 二选一设置用 checkbox 不符合 UX 惯例，应用 radio 或 select
- 文本框不支持 Enter 键发送消息
- 按钮文本直接替换导致宽度变化且无加载动画
- switchTab 用 onclick*= 属性选择器匹配脆弱应改用 data-tab 属性

## 后端
- fs.readFileSync 等同步 I/O 在 Express 中阻塞 event loop
- loadMemory 每次 /chat 请求都同步 readFileSync 成为性能热点
- saveMemory 的 read-then-write 模式在并发时存在竞态条件
- SSE 流式连接无 req.setTimeout() 保护
- tool call 循环无总耗时上限可能超过浏览器超时
- 全局异常 exit(1) 无 server.close() 优雅关闭
- 速率限制 Map 无最大容量限制 DDoS 时可无限增长
- 搜索缓存无容量上限和 LRU 淘汰
- 专家 .soul.md 文件加载无 try-catch，单文件损坏导致全部专家不可用
- 专家历史文件并发写入无锁，应使用 .tmp + rename 原子写入
- dotenv 被 app.js/tool-registry/expert-router 加载三次
- messages 数组在 tool call 循环中无限增长无截断
- AbortSignal.timeout 需在 package.json 声明 engines.node >= 17
- 工具 handler 缺少统一外层 try-catch 防御
- Schema required 字段缺失不符合 OpenAI Function Calling 规范

## 安全
- SSRF 防护代码缺失（安全基线表声明但未实现）
- __confirmed 确认机制由 AI 自设 true 可绕过确认
- find.js 和 list.js 缺少 realpath 符号链接校验
- curl/wget 在命令白名单中可与 SSRF 形成攻击链
- sanitizeExpertOutput 脱敏模式比 sanitizeText 少 3 种
- POST/PATCH 端点缺 CSRF 防护
- fetch_url 无 URL 格式和内网地址校验
- list.js 无敏感目录过滤暴露 .ssh/.aws 等目录存在性
- 绑定 0.0.0.0 无认证导致局域网全暴露
- .env 中 SERPER/TAVILY 真实密钥明文存储
- sanitizeText 缺少 tvly-dev- 和 tvly-live- 格式匹配
- API Token 用 !== 普通比较存在时序攻击风险
- tasks PATCH 无字段白名单可覆盖 id/createdAt 等属性
- 浏览器工具使用系统 Chrome 共享 Cookie 和 Session
- 安全规则是 prompt 级软约束依赖 LLM 遵循
- exec.js 先清除注释再检测特殊字符可能被构造绕过

## 搜索
- Claw Search 作为首选可靠性存疑应提升 Serper 优先级
- 搜索降级链全串行无并发，最坏延迟各引擎超时叠加
- deep 模式不使用缓存导致重复浪费 Tavily API 配额
- Tavily 搜索结果丢弃 snippet/content 字段导致信息质量下降
- 搜索缓存不是真正 LRU 而是最老淘汰（Oldest-First）
- 缓存无 TTL 过期主动清理机制
- DDG HTML 解析依赖 CSS class 和 testid，改版即失效
- 所有搜索函数缺少重试机制网络瞬断即降级
- extractURL 无 URL 校验直接传给第三方 API
- deep 模式 Tavily 失败直接返回 error 不降级
- ContextWire 搜索缺少 try-catch 包裹可能崩溃
- 搜索来源标识格式不一致（claw_search/serper/tavily/duckduckgo）

## 测试
- Phase2 SQLite 写入测试
