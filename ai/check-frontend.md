# 自由鸟前端质量检查报告

> 检查时间：2026-06-03
> 检查范围：`public/index.html`（全部前端代码，单文件 392 行）

---

## 一、严重 Bug（必须修复）

### 🔴 1. `api()` 函数无限递归（第 142-145 行）

```javascript
async function api(url, opts = {}) {
  opts.headers = { ...opts.headers, 'X-API-Token': API_TOKEN }
  return api(url, opts)  // ← BUG：调用自身，应调用 fetch()
}
```

**影响**：所有 API 请求都会导致 `RangeError: Maximum call stack size exceeded`，聊天、加载连接器、任务管理等全部功能无法使用。

**修复**：
```javascript
async function api(url, opts = {}) {
  opts.headers = { ...opts.headers, 'X-API-Token': API_TOKEN }
  return fetch(url, opts)
}
```

---

### 🔴 2. SSE 流式解码器未使用 `{stream: true}`（第 307-315 行）

```javascript
const reader = res.body.getReader()
const decoder = new TextDecoder()
let currentReply = ''
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  currentReply += decoder.decode(value)  // ← 缺少 {stream: true}
  bodyEl.textContent = currentReply
  ...
}
```

**影响**：中文字符（3 字节 UTF-8）若被分片切割到两次 `read()` 之间，`decoder.decode()` 会输出替换字符 `\uFFFD`，导致中文乱码。

**修复**：
```javascript
currentReply += decoder.decode(value, { stream: true })
```
循环结束后追加一次 `decoder.decode()` 清空内部缓冲区。

---

### 🔴 3. 连接器/专家名称未转义 XSS（第 181-198 行）

`loadConnectors()` 和 `loadExperts()` 直接拼接 `name` 到 `innerHTML`：

```javascript
// loadConnectors，第 183 行
list.innerHTML += `...<div class="connector-name">${name}</div>...`

// loadExperts，第 197 行  
list.innerHTML += `...<div class="connector-name">${name}</div>...`
```

虽然连接器名称来自后端（`Object.keys(connectors)`）且专家名来自硬编码数组，当前风险较低，但不符合纵深防御原则。如果未来支持动态注册连接器/专家，攻击者可通过服务端注入 XSS。

**修复**：对 `name` 使用 `escapeHtml(name)`。

---

### 🔴 4. 任务 ID 直接拼接在 onclick 属性中（第 229 行）

```javascript
onchange="toggleTask('${task.id}', this.checked)"
```

如果 `task.id` 包含单引号 `'`，会破坏 JS 语法。应在 HTML 属性中使用双引号并用 `encodeURIComponent` 编码，或改用 `data-*` 属性 + `addEventListener`。

**修复**：
```javascript
div.innerHTML = `...<input type="checkbox" data-id="${escapeHtml(task.id)}" ...>`
```

---

## 二、中等问题（建议修复）

### 🟡 5. 无暗色模式支持

- 所有颜色硬编码为亮色（`#fff`, `#f5f5f5`, `#333` 等）
- 无 CSS 变量或 `@media (prefers-color-scheme: dark)` 查询
- Electron 应用长期面对屏幕，暗色模式是基本需求
- **建议**：引入 CSS 变量，基于 `prefers-color-scheme` 或应用内开关切换

### 🟡 6. 无响应式设计

- 无任何 `@media` 查询
- 侧边栏固定 220px，主区域 `flex: 1`
- 窗口宽度 < 500px 时侧边栏会挤压内容区
- **建议**：添加移动端适配（窄窗口折叠侧边栏），至少添加一个 `@media (max-width: 600px)` 查询

### 🟡 7. confirm 对话框无过渡动画

```css
#confirmOverlay { display: none; ... }   /* 直接 display 切换 */
#confirmDialog { display: none; ... }
```

无淡入淡出效果，体验生硬。

**建议**：
```css
#confirmOverlay { opacity: 0; transition: opacity 0.2s; pointer-events: none; }
#confirmOverlay.show { opacity: 1; pointer-events: all; }
#confirmDialog { opacity: 0; transform: translate(-50%, -50%) scale(0.9); transition: all 0.2s; }
#confirmDialog.show { opacity: 1; transform: translate(-50%, -50%) scale(1); }
```

### 🟡 8. Toast 无队列机制

```javascript
function toast(msg) {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.classList.add('show')
  setTimeout(() => el.classList.remove('show'), 2000)
}
```

连续调用 `toast()` 会覆盖前一条消息。**建议**：引入消息队列或用多个 DOM 元素分摊。

### 🟡 9. 发送按钮文本直接替换丢失语义

```javascript
document.getElementById('sendBtn').textContent = '处理中...'
```

按钮宽度可能变化（"发送"2字 vs "处理中..."4字），且无旋转动画。

**建议**：使用 CSS 动画的 spinner + 禁用状态，保持按钮宽度不变。

### 🟡 10. `addMessage` 中时间戳写在 HTML 内

```javascript
const time = now.getHours().toString().padStart(2,'0') + ':' + ...
div.innerHTML = `<span>${time}</span><span class="msg-body">...</span>`
```

时间戳硬编码在 HTML 字符串中，无法格式化调整。不影响功能，但不利于国际化。

---

## 三、轻微问题（可选改进）

### 🟢 11. `TextDecoder` 未复用

每次 `send()` 调用都创建新的 `TextDecoder` 实例。可以复用同一个实例（`decoder.decode(value, {stream: true})` 支持流式解码）。

### 🟢 12. `pollHealth()` 退避算法在离线时指数增长到 60 秒

离线恢复后首次轮询需等待最多 60 秒。建议恢复连接后立即重置为 5 秒。

### 🟢 13. `loadSettings()` 错误处理过于宽泛

```javascript
catch (_) {}  // 静默吞掉所有错误
```

设置界面加载失败时不提供任何反馈。建议至少输出 `toast('加载设置失败')`。

### 🟢 14. `clearHistory()` 不重置消息 DOM

只清空 `history` 数组并替换 `messages` 的 `innerHTML`。但如果之前 `addMessage` 返回的 `replyEl` 引用还在使用，可能导致内存泄漏。当前代码无此问题，但未来扩展时需注意。

### 🟢 15. 无键盘导航

Tab 切换、对话框操作等不支持纯键盘导航。对于 Electron 桌面应用影响较小，但对无障碍（a11y）有影响。

---

## 四、安全性

| 检查项 | 状态 | 说明 |
|--------|------|------|
| XSS — 用户输入转义 | ✅ | `escapeHtml()` 基于 `textContent`，安全的 |
| XSS — 后端数据拼接 | ⚠️ | 连接器名/专家名未转义（见 🔴3） |
| CSP 头 | ✅ | 服务端设置 `Content-Security-Policy` |
| CSRF | ✅ | API 需要 `X-API-Token` 头 |
| 点击劫持 | ✅ | `X-Frame-Options: DENY` |
| 敏感信息泄露 | ✅ | 后端 `sanitizeText()` 脱敏处理 |
| innerHTML 注入 | ⚠️ | 多处 innerHTML += 拼接（见 🔴3, 🔴4） |

---

## 五、性能

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 首屏加载 | ✅ | 单文件 17KB，无外部依赖，快 |
| 渲染性能 | ✅ | 纯 DOM 操作，无框架开销 |
| 内存 | ⚠️ | `history` 本地数组只取最后 10 条，合理 |
| 网络 | ✅ | 60 秒超时 + 退避轮询 |
| 动画帧率 | ✅ | 无复杂动画 |

---

## 六、总结评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 代码结构 | 6/10 | 单文件内联 CSS/JS，缺乏模块化 |
| 安全性 | 7/10 | escapeHtml 正确，但拼接点遗漏 2 处 |
| SSE/流式渲染 | 5/10 | 解码器 bug 导致中文乱码风险 |
| 用户体验 | 5/10 | 无暗色模式、无响应式、动画不足 |
| 错误处理 | 6/10 | 大部分 catch 静默吞错 |
| 可维护性 | 5/10 | 单文件，全局变量，CSS 硬编码 |
| **综合** | **5.7/10** | |

---

## 七、优先修复路线图

### Phase 1 — 阻塞性 Bug（立即修复）
1. `api()` 递归调用改为 `fetch()`  
2. `TextDecoder.decode()` 添加 `{stream: true}`  
3. `loadConnectors()`/`loadExperts()` 对 name 做 escapeHtml

### Phase 2 — 体验提升（本周内）
4. 添加暗色模式  
5. confirm 对话框添加过渡动画  
6. 发送按钮添加 spinner 动画  

### Phase 3 — 长期优化
7. 响应式布局  
8. Toast 队列  
9. 代码拆分为模块（CSS 独立文件，JS 独立文件）
