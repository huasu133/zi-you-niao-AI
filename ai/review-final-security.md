# 自由鸟 v4 最终安全审查报告

> 审查日期: 2026-06-03
> 审查人: 安全专家 (security)
> 部署状态: 已部署，绑定 0.0.0.0:3456

---

## 一、之前审查报告中 2 个待改进项复查

### 1. SSRF 防护 — 待改进 (严重) → ❌ 未修复

**上次建议：**
> 如果后续需要本地 fetch 能力，必须实现 DNS 解析 → 检查内网 IP → 阻止 的 SSRF 防护链。

**复查结果：**

| 检查项 | 状态 |
|--------|:----:|
| `tools/fetch.js` 是否存在 | ❌ 不存在 |
| `extractURL()` 是否有 URL 校验 | ❌ 无校验，URL 直接发给 TAVILY API |
| 是否有 isPrivateIP 检查 | ❌ 无 |
| 是否实现 redirect 检查 | ❌ 无 |

`mcp-client.js:218` 中 `extractURL(url)` 直接将 URL 传给 TAVILY 第三方 SDK，无任何本地验证：

```js
// mcp-client.js:218-227
async function extractURL(url) {
  if (TAVILY_KEY) {
    const tavilyMod = await getTavilyMod()
    if (tavilyMod) {
      const Tavily = tavilyMod.default || tavilyMod.Tavily || tavilyMod.tavily
      if (Tavily) return await (typeof Tavily === 'function' 
        ? new Tavily({ apiKey: TAVILY_KEY }) 
        : Tavily({ apiKey: TAVILY_KEY })).extract(url)
    }
  }
  return { error: '未配置 TAVILY_API_KEY，无法使用页面提取' }
}
```

**当前风险级别：** 中（TAVILY 代理场景下无直接 SSRF，但 URL 未做白名单/格式校验是安全隐患）

### 2. __confirmed 写保护 — 待改进 (中) → ❌ 未修复

**上次建议：**
> 改为服务端生成确认 token + 验证机制，防止 AI 自行设置 `__confirmed: true` 绕过确认。

**复查结果：**

`tool-registry.js:130,149` 仍使用自声明确认模式：

```js
// tool-registry.js:136
if (!args.__confirmed) return JSON.stringify({ 
  error: '写文件操作需要确认，请说明要写入的路径和内容，确认后将重试' 
})
```

- ❌ 无服务端 token 生成
- ❌ 无 nonce/crypto 验证
- ❌ AI 可在下一轮 tool call 自主携带 `"__confirmed": true`
- ❌ 没有 HMAC 签名或 session 验证

**当前风险级别：** 中（AI 可自问自答自批准执行写操作和命令）

---

## 二、0.0.0.0 绑定新增风险分析

### 变更说明

```js
// 旧: app.listen(PORT, '127.0.0.1', ...)  // 仅本机
// 新: app.listen(PORT, '0.0.0.0', ...)     // 所有网络接口
```

### 风险评估

| 风险项 | 等级 | 说明 |
|--------|:----:|------|
| 局域网全暴露 | ⚠️ 高 | 同网络内任何设备可访问 `http://<本机IP>:3456` |
| 无认证机制 | ⚠️ 高 | 无登录、无 API Key 验证、无 session token |
| 无 TLS 加密 | ⚠️ 中 | 纯 HTTP，局域网内可被嗅探（包括 API Key 在请求中的传输） |
| CSRF 攻击升级 | ⚠️ 中 | 原 127.0.0.1 下 CSRF 仅本机可利用，现同一局域网任意主机可发起 CSRF |
| 写端点暴露 | ⚠️ 高 | `POST /tasks`、`POST /api/config`、`PATCH /tasks/:id` 均可从局域网访问 |
| `/chat` 端点暴露 | ⚠️ 高 | 任何人都可调用 AI 对话，消耗 API 配额 |
| 无 IP 白名单 | ⚠️ 中 | 没有限定允许访问的 IP 范围 |
| 速率限制不足 | ⚠️ 中 | 速率限制按 IP+path 区分，但攻击者可伪造 IP（X-Forwarded-For 未校验） |

### 具体攻击场景

1. **API 配额消耗攻击：** 局域网内任何人发送 `/chat` 请求消耗 DEEPSEEK API 额度
2. **配置篡改：** `POST /api/config` 可修改搜索模式
3. **任务注入：** `POST /tasks` 可创建任意任务
4. **工具调用链攻击：** 通过 `/chat` → tool call → `run_command` 在宿主机执行命令
5. **信息泄露：** `/experts`、`/tools`、`/connectors` 端点暴露系统架构信息

### 建议修复（按优先级）

1. **[紧急] 添加认证层**
   ```js
   // 建议：API Key 或 Bearer Token 验证中间件
   app.use((req, res, next) => {
     const token = req.headers.authorization?.replace('Bearer ', '')
     if (token !== process.env.ACCESS_TOKEN) {
       return res.status(401).json({ error: '未授权' })
     }
     next()
   })
   ```

2. **[高] 限定绑定地址**
   - 如果不需要外部访问，改回 `127.0.0.1`
   - 如果需要局域网访问，至少限定具体 IP 或添加认证

3. **[中] 添加 CORS/Origin 校验**
   - 当前无任何 CORS 中间件和 Origin 检查

4. **[中] 改回 127.0.0.1 + 使用 SSH 隧道/反向代理 进行远程访问**

---

## 三、.env 文件安全

### 检查结果

| 检查项 | 状态 |
|--------|:----:|
| .gitignore 包含 .env | ✅ 通过 |
| .env 未被提交到 git | 需验证 |
| DEEPSEEK_API_KEY | ⚠️ 占位符 "你的Key" |
| GITHUB_TOKEN | ⚠️ 占位符 "你的Token" |
| SERPER_API_KEY | ❌ **真实密钥** `SERPER_KEY_HIDDEN` |
| TAVILY_API_KEY | ❌ **真实密钥** `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` |
| CONTEXTWIRE_API_KEY | ✅ 空值 |

### 风险分析

1. **SERPER 和 TAVILY 密钥为真实有效密钥**
   - TAVILY 是 dev key（`tvly-dev-` 前缀），有使用限制但可被滥用
   - SERPER key 可消耗搜索配额

2. **0.0.0.0 绑定放大了泄露面**
   - 任何能访问文件系统的人都能读取 `.env`
   - 如果存在路径遍历漏洞，攻击者可通过 `/chat` → `read_file` 读取 `.env`（已被 SENSITIVE_PATTERNS 阻止，但防御深度不够）

3. **sanitizeText 对 TAVILY key 格式的保护不足**
   - `app.js:139` 脱敏模式匹配 `TAVILY_API_KEY=***`，但若 key 单独出现在输出中不会被脱敏
   - TAVILY key 格式 `tvly-dev-` 和 `tvly-live-` 不在 sanitizeText 的单独匹配列表中

4. **SERPER key 格式无专门脱敏规则**
   - SERPER key 是 40 位 hex 字符串，没有类似 `ghp_` 的固定前缀，无法被精确匹配脱敏

### 建议修复

1. **[高] 立即轮换 SERPER 和 TAVILY API Key**
   - 因为这俩 key 已在 `.env` 文件中，且此报告也会被存档
   - 生成新 key 后，旧 key 应立即吊销

2. **[中] 在 sanitizeText 中增加 TAVILY key 格式的匹配**
   ```js
   { regex: /tvly-(dev|live)-[a-zA-Z0-9]+/g, replacement: 'tvly-$1-***' },
   ```

3. **[低] 使用系统环境变量替代 .env 文件**
   - 对于生产部署，建议通过系统环境变量或密钥管理服务注入敏感值

---

## 四、v4 版本安全改进（正面变化）

自上次审查以来发现的改进：

| 改进项 | 说明 |
|--------|------|
| ✅ sanitizeText 新增 `github_pat_` | `app.js:135` 新增 GitHub PAT 脱敏 |
| ✅ sanitizeExpertOutput 升级至 7 模式 | `expert-router.js:19-28`，从 4 模式扩展到 7 模式（新增 PEM 私钥、sk-、github_pat_） |
| ✅ 速率限制细化 | `/tasks` 15次/分、`/api/config` 10次/分（原为默认 30次/分） |
| ✅ 速率限制缓存防膨胀 | 新增 5000 条上限清理 (`app.js:57-61`) |

---

## 五、仍未修复的低优先级问题

| 问题 | 位置 | 风险 |
|------|------|:----:|
| find.js 缺 realpath 校验 | `tools/find.js` | 低 |
| list.js 缺 realpath 校验 | `tools/list.js` | 低 |
| list.js 无敏感目录过滤 | `tools/list.js` | 低 |
| CSP 含 unsafe-inline | `app.js:65` | 低 |
| 缺少 CORP / HSTS 头 | `app.js:64-69` | 低 |
| find.js pattern 参数用黑名单移除而非拒绝 | `tools/find.js` | 低 |
| curl/wget 在白名单中 | `tools/exec.js` | 低 |
| write.js SENSITIVE_PATTERNS 不完整 | `tools/write.js` | 低 |

---

## 六、综合结论

### 整体评级: 需关注

自由鸟 v4 的**核心安全设计**（路径遍历防护、命令注入防护、输出脱敏）保持良好，但 **0.0.0.0 绑定带来了显著的新风险面**，且之前的 2 个待改进项仍未修复。

### 必须立即处理

| 优先级 | 问题 | 风险 |
|:------:|------|:----:|
| P0 | 0.0.0.0 绑定无认证 → 建议改回 127.0.0.1 或添加认证层 | 高 |
| P0 | 轮换 .env 中泄露的 SERPER/TAVILY API Key | 高 |
| P1 | __confirmed 机制仍可被 AI 绕过 | 中 |
| P1 | 补充 fetch.js SSRF 防护或从安全基线声明中移除 | 中 |

### 风险矩阵

| 场景 | 127.0.0.1 (旧) | 0.0.0.0 (新) |
|------|:---:|:---:|
| 远程利用 | ❌ 不可能 | ✅ 局域网可访问 |
| CSRF 攻击 | 仅本机 | 局域网所有设备 |
| API 配额窃取 | 需本地权限 | 局域网内任何人 |
| 命令执行 | 需本地交互 | 通过 /chat + tool call |
| 信息泄露 | 仅本机 | 局域网内嗅探 |

**核心建议：如果没有明确的局域网访问需求，立即将绑定改回 `127.0.0.1`。**
