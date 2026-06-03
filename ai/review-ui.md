# Web UI 审查报告 — 自由鸟 v4

> 审查时间：2026-06-03
> 审查范围：`public/index.html`（单文件内联 HTML + CSS + JS）
> 定位：桌面端 AI 对话工具，供单人使用

---

## 一、布局结构 — 评分 7/10

```
.sidebar (220px fixed) | .main (flex:1)
```

**优点：**
- Flexbox 实现简洁可靠，主区域自动填充剩余空间
- 导航项带 active 状态高亮，视觉反馈清晰
- 底部状态栏固定在 sidebar 末尾（`margin-top: auto`），设计合理

**问题：**

| # | 严重度 | 问题 | 建议 |
|---|:---:|------|------|
| 1 | 中 | sidebar 固定 220px，在小屏（<1024px）占用过多空间，聊天区过窄 | 加 `@media (max-width: 768px)` 将 sidebar 改为可折叠或底部 TabBar |
| 2 | 低 | sidebar 如果后续导航项增多（如新增"日志"Tab），无滚动能力 | `.sidebar` 加 `overflow-y: auto` |
| 3 | 低 | 主区域无最小宽度限制，极窄窗口下内容可能被挤变形 | `.main` 加 `min-width: 0`（配合 flex 子元素溢出处理） |
| 4 | 低 | 无 sidebar 折叠/展开功能，对 13 寸笔记本不够友好 | 考虑加折叠按钮（目前 6 个 nav-item 够用，优先级低） |

---

## 二、聊天界面 — 评分 6.5/10

**消息气泡：**
- `.msg-user`：浅蓝背景 + 左缩进 40px，区分度可
- `.msg-ai`：白底 + 边框 + 右缩进 40px，区分度可
- `.msg-system`：黄色警告风格，适合系统消息

**输入区：**
- textarea + 发送/清空按钮，布局简洁
- 发送中 `disabled + "处理中..."` 文案切换

**时间戳：**
- JS 端生成 HH:MM 格式，写入消息前

**问题：**

| # | 严重度 | 问题 | 建议 |
|---|:---:|------|------|
| 1 | 高 | 不支持 Enter 发送（需点按钮），频繁对话时体验差 | 加 `input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } })` |
| 2 | 中 | 流式输出时 `replyEl.textContent = currentReply` 全量替换，无平滑滚动，长回复时需手动滚到底 | 每次更新后 `replyEl.scrollIntoView({ behavior: 'smooth', block: 'end' })` |
| 3 | 中 | 没有空状态引导（首次打开 chat 区一片空白） | 加欢迎语/快捷操作提示，如 "你好，我是自由鸟 AI 总控，可以帮你读文件、搜信息、执行任务" |
| 4 | 中 | 消息中无 Markdown 渲染，AI 回复的代码块、列表等纯文本显示 | 考虑引入轻量 Markdown 渲染（如 marked.js），或至少做 `<pre>` / `<code>` 基础换行 |
| 5 | 低 | textarea 无自动增高（rows=2 固定），长输入不够用 | CSS `field-sizing: content` 或 JS 动态调整高度 |
| 6 | 低 | 用户消息无头像/角色标识，仅靠左边距区分，视觉层次弱 | 在消息左侧加圆形头像（emoji 即可，如 🤖 / 👤） |
| 7 | 低 | 时间戳仅显示 HH:MM，同一天内 OK，但跨天无日期信息 | 跨天时自动加日期前缀 `06-03 14:30` |

---

## 三、连接器面板 — 评分 6/10

**卡片组件：**
- `.connector-card` 使用 flex + 圆角 + 边框，风格统一
- 状态圆点（绿色/灰色）直观

**问题：**

| # | 严重度 | 问题 | 建议 |
|---|:---:|------|------|
| 1 | 中 | 卡片无可操作按钮，用户看到"已连接/未配置"但不知道去哪配 | 加 "配置" 链接或按钮，未配置时导向 `.env` 提示 |
| 2 | 中 | 加载/错误状态仅显示"加载中..."文本，无骨架屏或重试按钮 | 加 loading spinner + 错误重试按钮 |
| 3 | 低 | 卡片无 hover 效果，交互感弱 | `.connector-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.08); }` |
| 4 | 低 | 连接器数量 badge 只在 sidebar 显示，面板内无汇总统计 | 面板顶部加统计行 "2 个连接器 · 1 个已连接" |

---

## 四、任务管理 — 评分 6/10

**创建/筛选/完成：**
- 筛选下拉框（全部/未完成/已完成）+ 创建输入框 + 添加按钮
- checkbox 切换完成状态，已完成任务降低透明度 + 删除线

**问题：**

| # | 严重度 | 问题 | 建议 |
|---|:---:|------|------|
| 1 | 中 | 没有编辑/删除任务功能（创建后只能标记完成） | 加编辑按钮（修改标题/描述）+ 删除按钮（需确认对话框） |
| 2 | 中 | checkbox 切换后立即 `loadTasks()` 全量刷新，无乐观更新，网络慢时体验差 | 先乐观更新 DOM（toggle opacity/line-through），再发 PATCH，失败时回滚 |
| 3 | 低 | 已完成任务只有 opacity:0.5 区分，对比度不足 | 已完成任务加灰色文字 + 更明显的视觉区分（如浅灰背景） |
| 4 | 低 | 无待办数量徽章在顶部统计 | 面板顶部加 "3 个待办 · 5 个已完成" |
| 5 | 低 | Enter 键不支持添加任务 | `taskInput` 加 keydown 监听 Enter |
| 6 | 低 | 任务描述字段在创建 UI 中无输入框（只能创建标题） | 考虑添加描述输入框，或让标题支持更丰富内容 |

---

## 五、设置面板 — 评分 6.5/10

**搜索模式切换：**
- checkbox 实现的“快速 ↔ 深度”切换，切换后调 `/api/config` 保存

**连接器状态：**
- 加载 GitHub 连接状态显示 ✅/❌

**问题：**

| # | 严重度 | 问题 | 建议 |
|---|:---:|------|------|
| 1 | 中 | 搜索模式用 checkbox 表达"二选一"不符合 UX 惯例，标签 "快速" 和 "深度" 分别位于开关两侧，暗示两者可同时选中 | 改用 `<select>` 下拉或 radio group，或 toggle switch 明确表示二选一 |
| 2 | 中 | 无设置的保存反馈（仅 `toast()` 提示），`toggleSearchMode` 内部调用 `toast` 但 `toast` 函数**未定义** | 实现 toast 组件，或设置项旁加短暂"已保存"文字反馈 |
| 3 | 中 | 设置项混合展示（服务器地址/模型是只读信息，搜索模式/连接器是可配置项），视觉无区分 | 用分隔标题或卡片分组区分 "系统信息" 和 "可配置项" |
| 4 | 低 | 切换搜索模式时 label 粗体切换逻辑有歧义（`isDeep ? 'normal' : 'bold'` 高亮的是"当前选中"而不是"快速"选项名） | 统一高亮策略，current mode label 加粗 + primary 色 |
| 5 | 低 | 无深色模式开关 | 当前阶段可接受，后续版本考虑 |

---

## 六、确认对话框 — 评分 7/10

**Overlay + Dialog 居中：**
- overlay 全屏半透明遮罩 (`position: fixed; rgba(0,0,0,0.3)`)
- dialog 用 `transform: translate(-50%, -50%)` 居中

**按钮颜色：**
- 拒绝按钮红色 `#e74c3c`，允许按钮绿色 `#27ae60`，语义清晰

**问题：**

| # | 严重度 | 问题 | 建议 |
|---|:---:|------|------|
| 1 | 中 | 不支持键盘操作：无法按 Escape 关闭，无法 Enter 确认，Tab 焦点可能逃逸到背后元素 | 加 `keydown` 监听 Escape 触发拒绝 + Enter 触发允许；打开 dialog 时设 `document.body.style.overflow = 'hidden'` |
| 2 | 中 | 点击 overlay 不关闭对话框 | overlay 加 `onclick="confirmAction(false)"` |
| 3 | 低 | dialog 无标题（`confirmMsg` 直接放正文），复杂确认场景上下文不足 | 加 `<div id="confirmTitle">` 可选标题，`showConfirm` 函数增强为 `showConfirm(title, msg, callback)` |
| 4 | 低 | 无打开/关闭过渡动画，弹出生硬 | 加 CSS transition `opacity 0.2s, transform 0.2s` |
| 5 | 低 | z-index 100/101 可能与其他绝对定位元素冲突 | 统一 z-index 层级体系，如 overlay=1000, dialog=1001 |

---

## 七、响应式适配 — 评分 2/10

**当前状态：完全无响应式。**

无任何 `@media` 查询，无 `viewport` meta 标签设置，无移动端适配策略。

**文档声明：** "当前仅桌面端"，但方案中未提后续适配计划。

**建议（优先级排序）：**

| 优先级 | 屏幕宽度 | 适配策略 |
|:---:|------|------|
| P1 | ≥1024px（当前） | 保持 220px sidebar + flex:1 主区域 |
| P2 | 768-1023px | sidebar 缩至 56px（仅图标），hover 时展开；或顶部导航栏 |
| P3 | <768px | 底部 TabBar 切换（对话/连接器/任务/设置），全屏单面板 |

**必须修复：**
- 加 `<meta name="viewport" content="width=device-width, initial-scale=1.0">` — 当前文档缺少此行

---

## 八、CSS 设计一致性 — 评分 6/10

**颜色：**

| 用途 | 色值 | 评价 |
|------|------|------|
| Primary | `#4a6cf7` | 统一使用 ✅ |
| Success | `#27ae60` | 确认按钮 + 连接器状态一致 ✅ |
| Danger | `#e74c3c` | 确认拒绝按钮一致 ✅ |
| Border | `#e0e0e0` | 全局统一 ✅ |
| Background | `#f5f5f5` | 全局背景 ✅ |
| Hover bg | `#f0f4ff` | sidebar active/hover 一致 ✅ |
| Text primary | `#555` | 导航文字 ✅ |
| Text muted | `#999` | 状态文字 ✅ |

**间距：**

| 位置 | 值 | 是否一致 |
|------|:---:|:---:|
| sidebar padding | 20px | - |
| nav-item padding | 12px 20px | ✅ |
| chat-messages padding | 20px | ✅ |
| chat-input-area padding | 12px 20px | ✅ |
| connector-list padding | 20px | ✅ |
| connector-card padding | 15px | ⚠️ 与 20px 不统一 |
| settings-panel padding | 20px | ✅ |
| setting-row padding | 15px | ⚠️ 同上 |
| confirmDialog padding | 24px | ⚠️ 特例 |

**字体：**
- 仅 `-apple-system, sans-serif`，无 Windows 字体回退
- 字号混用 px（11px / 13px / 14px / 18px），建议统一为 rem 基准

**圆角：**

| 元素 | 值 |
|------|:---:|
| chat-input | 8px |
| btn-primary | 6px |
| btn-secondary | 6px |
| connector-card | 8px |
| setting-row | 8px |
| msg 气泡 | 8px |
| confirmDialog | 12px |

**关键改进项：**

| # | 严重度 | 问题 | 建议 |
|---|:---:|------|------|
| 1 | 中 | 所有颜色硬编码，无 CSS 变量，后续改主题需逐行替换 | 定义 `:root { --primary: #4a6cf7; --success: #27ae60; --danger: #e74c3c; --border: #e0e0e0; --bg: #f5f5f5; --radius: 8px; --spacing: 16px; }` |
| 2 | 中 | 无 Windows 字体回退 | `font-family: -apple-system, "Microsoft YaHei", "PingFang SC", sans-serif` |
| 3 | 低 | 按钮样式不统一：btn-primary 用 `padding: 8px` 但 `.chat-actions .btn-primary` 用 `flex: 1` 宽展，.btn-allow 用 `padding: 8px 20px` | 按钮统一为 `.btn { padding: 8px 16px; border-radius: var(--radius); }` 基础类 |
| 4 | 低 | 无 :focus-visible 样式，纯键盘操作无视觉反馈 | 加 `:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }` |
| 5 | 低 | 无过渡动画，所有状态切换均为瞬时 | `transition: background 0.15s, color 0.15s, opacity 0.15s` 挂载到交互元素 |

---

## 九、其他发现

### 9.1 JavaScript 代码问题

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| 1 | 高 | `toast()` 函数被调用但**未定义**，切换搜索模式时会报 ReferenceError | `toggleSearchMode()` |
| 2 | 中 | `history` 数组只存了 assistant 消息，缺少 user 消息，导致发给 /chat 的 history 缺少用户侧上下文 | `send()` 函数 |
| 3 | 中 | 消息使用 `innerHTML` 拼接，存在 XSS 风险（用户输入直接嵌入 HTML） | `addMessage()` — `text.replace(/\n/g, '<br>')` 后直接插 innerHTML |
| 4 | 低 | `switchTab` 用 `onclick*=` 属性选择器查找 nav-item，脆弱且不可读 | 给 nav-item 加 `data-tab` 属性 |
| 5 | 低 | `loadSettings` 每次切换都重新 fetch `/connectors`，不必要的重复请求 | 缓存连接器状态或仅在首次加载时请求 |

### 9.2 无障碍

| # | 严重度 | 问题 |
|---|:---:|------|
| 1 | 中 | 无 `<html lang="zh-CN">` |
| 2 | 中 | 按钮多为 `<div>` 或 `<button>` 无 `aria-label` |
| 3 | 中 | 无 skip link，键盘用户需 Tab 通过所有 nav-item 才能到内容 |
| 4 | 低 | 消息区无 `role="log"` / `aria-live` 区域，屏幕阅读器不会自动播报新消息 |

---

## 十、总结

### 各面板评分汇总

| 面板 | 评分 | 等级 |
|------|:---:|:---:|
| 布局结构 | 7/10 | 良好 |
| 聊天界面 | 6.5/10 | 及格 |
| 连接器面板 | 6/10 | 及格 |
| 任务管理 | 6/10 | 及格 |
| 设置面板 | 6.5/10 | 及格 |
| 确认对话框 | 7/10 | 良好 |
| 响应式适配 | 2/10 | 缺失 |
| CSS 设计一致性 | 6/10 | 及格 |
| **综合** | **5.9/10** | **及格** |

### 总体评价

作为 **MVP 阶段的单文件内联 UI**，方案完成度尚可。核心交互路径（对话 → 工具调用 → 回复）闭环完整，布局结构清晰，配色统一。适合一个工作日内快速启动。

**但存在以下必须修复的阻塞项（部署前解决）：**

1. **`toast()` 未定义** — 切换搜索模式时报错
2. **XSS 风险** — `addMessage` 的 `innerHTML` 拼接需做 HTML 转义
3. **缺少 `<meta viewport>`** — 移动端完全不可用
4. **Enter 键发送缺失** — 聊天体验的核心交互
5. **history 数组丢失 user 消息** — 多轮对话上下文不完整

**中优先级建议（部署后第一周内改进）：**
- CSS 变量化 + 字体回退 + 焦点样式
- 确认对话框键盘支持
- 任务乐观更新

**低优先级建议（后续迭代）：**
- 响应式适配
- Markdown 渲染
- 深色模式

---

*审查完成。方案整体方向正确，细节需打磨。建议先修复 5 个阻塞项再部署。*
