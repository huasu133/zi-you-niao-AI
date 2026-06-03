# 自由鸟 v4 搜索系统审查报告

> 审查日期: 2026-06-03
> 审查人: 搜索技术专家 (search-expert)
> 审查文件: `F:/ziyouniao/mcp-client.js` (246 行)
> 依赖: `@tavily/core` (optional), `@contextwire/sdk` (optional), `dotenv`

---

## 一、总体评估

| 维度 | 评分 | 说明 |
|------|:----:|------|
| 架构设计 | 7/10 | 降级链思路正确，但引擎选择优先级有争议 |
| 缓存策略 | 6/10 | 有基础 TTL+LRU，但实现粗糙且覆盖不完整 |
| 双模式体验 | 5/10 | basic/deep 设计意图正确，但 deep 模式缺少缓存，存在体验分裂 |
| API 调优 | 5/10 | Tavily 参数使用正确但未充分利用 |
| HTML 解析 | 4/10 | DDG 解析有三个后备正则，但整体防御面弱 |
| 安全脱敏 | 8/10 | 设计合理，但存在误杀风险 |
| **综合** | **5.8/10** | 可用但不完善，建议优先修复高优先级项目 |

---

## 二、5 级降级链 (Claw → Serper → Tavily → DDG → CW) 战略分析

### 2.1 当前链路

```
basic 模式: Claw Search → Serper(Google) → Tavily → DuckDuckGo → ContextWire
deep 模式:  Tavily Deep → Serper → Claw → DuckDuckGo (无 CW)
```

### 2.2 问题分析

#### 问题 1: Claw Search 作为首选的可靠性存疑

`clawSearch()` 调用 `https://www.claw-search.com/api/search`，这是一个非知名搜索 API。审查时的发现：

- **无 API Key 认证**: Claw Search 不需要任何密钥即可调用 (L68-72)
- **域名风险**: `claw-search.com` 不是主流搜索服务，其可用性、SLA、数据质量均无公开保障
- **无重试机制**: 任何网络波动都会导致直接降级到下一级
- **无结果质量校验**: 不对返回的 title/url 做为空或格式校验

**建议**: 将 Serper (Google API) 提升为首选，Claw Search 作为免费补充降级到第三位，或至少对 Claw 添加健康检查探针。

```js
// 建议调整后的优先级:
// Serper(Google) → Tavily(basic) → Claw Search → DDG → CW
```

#### 问题 2: Serper 位置偏低

Serper 调用的是 Google 搜索 API，结果质量通常是所有引擎中最高的。但它在降级链中排在第二位，意味着主要流量都走 Claw Search。

**建议**: 如果有 SERPER_KEY，优先使用 Serper，没有 KEY 时自动跳过。

#### 问题 3: 无并行竞速机制

当前所有搜索都是**严格串行**的 (L174-198):

```js
const claw = await clawSearch(query).catch(() => [])
if (claw.length > 0) { ... return }
const serper = await serperSearch(query).catch(() => [])
// ...
```

这意味着在 Claw 超时 (10s) 之前，Serper 永远不会被调用。用户体验最坏情况下会经历 5 个引擎的超时叠加。

**建议**: 采用 "先发后到" 竞速模型：

```js
// 同时发起 3 个请求，第一个成功即返回
const results = await Promise.any([
  serperSearch(query),
  clawSearch(query),
  tavilySearch(query),
])
```

但这需要配合去重和统一格式。当前串行设计更适合低成本运行（不浪费 API 配额），如果是 cost-first 策略可以理解，但需要在代码中注释说明。

#### 问题 4: deepSearchWeb 降级链与 searchWeb 不一致

`deepSearchWeb()` (L202-216) 的降级链是 `Tavily Deep → Serper → Claw → DDG`，**没有 ContextWire** 兜底。而 `searchWeb` 在 basic 模式有 CW 兜底。这种不一致会导致 deep 模式在 DDG 也失败时直接返回 error，而非继续尝试 CW。

**建议**: 统一两端的降级链列表，或者将 CW 也加入 deep 模式降级。

---

## 三、缓存策略审查

### 3.1 当前实现

```js
const SEARCH_CACHE = {}          // 内存对象，进程重启即丢失
const CACHE_TTL = 3600 * 1000    // 1 小时
const MAX_CACHE_SIZE = 200        // 最多 200 条

function trimCache() {
  const keys = Object.keys(SEARCH_CACHE)
  if (keys.length > MAX_CACHE_SIZE) {
    let oldest = null
    for (const [k, v] of Object.entries(SEARCH_CACHE)) {
      if (!oldest || v.time < oldest.time) oldest = { key: k, time: v.time }
    }
    if (oldest) delete SEARCH_CACHE[oldest.key]
  }
}
```

### 3.2 问题分析

#### 问题 1: 不是真正的 LRU，是最老淘汰 (Oldest-First)

`trimCache()` 删除的是 `time` 最小的记录（即最早加入的），而非最近最少使用的。真正的 LRU 需要一个额外的 `lastAccess` 时间戳，并在每次缓存命中时更新。

这个实现的问题是：如果用户反复搜索一个很早之前的关键词，这个关键词仍然是 "最老" 的，可能被误淘汰，即使它是热点查询。

**建议**: 改为真正的 LRU：
```js
// 命中时更新 accessTime
SEARCH_CACHE[query] = { results: cached.results, time: cached.time, accessed: Date.now() }
// trim 时按 accessed 排序淘汰
```

#### 问题 2: 逐出效率低

每次写入都可能触发 `trimCache()`，但每次只删除 1 条。如果缓存从 200 膨胀到 300（例如批量搜索），需要 100 次写入才能降到 200 以内。`O(n)` 遍历所有条目找最老的记录。

**建议**: 批量逐出或提高逐出数量：
```js
if (keys.length > MAX_CACHE_SIZE) {
  const toDelete = keys.length - MAX_CACHE_SIZE + 10  // 多删 10 条，减少后续 trim 频率
  // 按时间排序，删除最老的 toDelete 条
}
```

#### 问题 3: 缓存只覆盖 basic 模式

```js
// L160-165: 只有 basic 模式读缓存
if (currentSearchMode === 'basic') {
  const cached = SEARCH_CACHE[query]
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return { results: cached.results, source: 'cache', cached: true }
  }
}
```

deep 模式 (L167-171) 完全不读缓存也不写缓存。这意味着：

- 用户在 basic 和 deep 之间切换时，相同关键词会重复请求 Tavily（浪费 API 配额和时间）
- deep 的 Tavily Deep Search 调用成本更高，却不做缓存，是一种浪费

**建议**: 统一缓存读写逻辑，至少在 deep 模式下也写入缓存。

#### 问题 4: 缓存未考虑 TTL 过期清理

`trimCache()` 只在写入时触发，不主动清理过期条目。过期条目会一直占用内存直到被逐出，或者直到 MAX_CACHE_SIZE 触发 LRU。对于低频使用场景，过期数据可能永远留在内存中。

**建议**: 添加 `setInterval` 定时清理（每 10 分钟一次），或在 trimCache 中同时清理过期条目。

#### 问题 5: 内存缓存无持久化

进程重启后所有缓存丢失，冷启动完全依赖外部 API。如果所有外部 API 同时不可用，重启后的搜索将全部失败。

**建议**: 考虑添加可选的磁盘持久化（如 JSON 文件），或在 `exit` 时 dump 缓存。

---

## 四、双模式切换 (basic vs deep) 体验分析

### 4.1 当前实现

```js
let currentSearchMode = 'basic'   // 模块级变量
function setSearchMode(mode) { currentSearchMode = mode }
function getSearchMode() { return currentSearchMode }
```

模式切换通过 `tool-registry.js` 暴露的 `setSearchMode` 和 `getSearchMode`，工具注册表中没有对应的 tool，切换只能通过代码调用。

### 4.2 问题分析

#### 问题 1: 模式切换对用户不可见

工具注册表中**没有 `set_search_mode` 工具**，AI 无法主动切换模式。用户也无法通过自然语言（如 "切换为深度搜索"）来切换模式。

**建议**: 在 TOOLS 数组中添加一个 `set_search_mode` 工具：

```js
{
  type: 'function',
  function: {
    name: 'set_search_mode',
    description: '切换搜索模式：basic(快速) 或 deep(深度)',
    parameters: {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['basic', 'deep'] } },
      required: ['mode'],
    },
  },
  handler: async (args) => {
    setSearchMode(args.mode)
    return JSON.stringify({ mode: args.mode, message: `已切换到${args.mode === 'deep' ? '深度' : '快速'}搜索模式` })
  },
}
```

#### 问题 2: deep 模式行为不一致

`searchWeb()` 在 `currentSearchMode === 'deep'` 时走 `tavilyDeepSearch`，失败后直接返回 error (L168-170)，**完全不降级**：

```js
if (currentSearchMode === 'deep' && TAVILY_KEY) {
  const tv = await tavilyDeepSearch(query).catch(() => [])
  if (tv.length > 0) return { results: tv, source: 'tavily_deep' }
  return { error: '深度搜索无结果，请尝试换关键词或切换回快速模式' }
}
```

这与其他降级策略不一致。`deepSearchWeb()` 函数 (L202-216) 有自己的降级链，但 `searchWeb` 在 deep 模式下根本不使用它。

**建议**: 统一 deep 模式行为，在 Tavily Deep 失败时自动降级到 `deepSearchWeb` 的链路，而非直接返回 error。

#### 问题 3: Tavily basic vs deep 参数几乎相同

```js
// tavilySearch (basic)
client.search(query, {
  searchDepth: 'basic', maxResults: 10, includeAnswer: true,
})

// tavilyDeepSearch (deep)
client.search(query, {
  searchDepth: 'deep', maxResults: 10, includeAnswer: true,
})
```

唯一的区别是 `searchDepth`。basic 和 deep 的 Tavily 调用代码几乎完全重复（L108-121 vs L123-136），违反 DRY 原则。

**建议**: 合并为统一函数：
```js
async function tavilySearch(query, { depth = 'basic', maxResults = 10 } = {}) {
  if (!TAVILY_KEY) return []
  const tavilyMod = await getTavilyMod()
  if (!tavilyMod) return []
  const Tavily = tavilyMod.default || tavilyMod.Tavily || tavilyMod.tavily
  if (!Tavily) return []
  const client = typeof Tavily === 'function' ? new Tavily({ apiKey: TAVILY_KEY }) : Tavily({ apiKey: TAVILY_KEY })
  const result = await client.search(query, { searchDepth: depth, maxResults, includeAnswer: true })
  const items = result.results?.map(r => ({ title: r.title, url: r.url, snippet: r.content })) || []
  if (result.answer) items.unshift({ title: 'AI 总结', url: '', summary: result.answer })
  return items
}
```

---

## 五、Tavily API 参数调优建议

### 5.1 当前参数

```js
{
  searchDepth: 'basic' | 'deep',
  maxResults: 10,
  includeAnswer: true,
}
```

### 5.2 问题与建议

#### 建议 1: 利用 `includeDomains` / `excludeDomains`

Tavily 支持领域筛选，可以提升特定场景的搜索精度：

```js
// 技术搜索示例
client.search(query, {
  searchDepth: 'advanced',     // Tavily 实际支持 'advanced' 而非 'deep'?
  maxResults: 10,
  includeAnswer: true,
  includeDomains: ['github.com', 'stackoverflow.com', 'docs.python.org'],
})
```

**注意**: 需要确认 `@tavily/core` v1 的参数是否使用 `'advanced'` 或 `'deep'`。Tavily API 文档中搜索深度可能用 `'advanced'` 而非 `'deep'`。

#### 建议 2: 增加 `includeRawContent` 用于优质来源

对于深度搜索，包含原始内容可以提升下游 AI 的理解质量：
```js
{ includeRawContent: true }
```

但需注意这会增加 token 消耗。

#### 建议 3: `maxResults` 策略

当前 basic 和 deep 都使用 `maxResults: 10`。但在降级链场景中，basic 模式实际只会用到前 5 条返回。建议：

- **basic 模式**: `maxResults: 5`，减少 API 消耗
- **deep 模式**: `maxResults: 10`，保持当前值

#### 建议 4: 添加 `days` 参数用于时效性搜索

Tavily 支持 `days` 参数限定结果时效性：
```js
{ days: 7 }   // 只返回 7 天内的内容
```

建议在查询中包含时间关键词时（如 "最新"、"2024"、"今日"）自动设置此参数。

#### 建议 5: 避免每次创建新客户端

当前每次 `tavilySearch()` 都创建新的 Tavily 客户端 (L114)，应缓存为模块级单例：

```js
let _tavilyClient = null
async function getTavilyClient() {
  if (_tavilyClient === null && TAVILY_KEY) {
    const tavilyMod = await getTavilyMod()
    if (tavilyMod) {
      const Tavily = tavilyMod.default || tavilyMod.Tavily || tavilyMod.tavily
      if (Tavily) {
        _tavilyClient = typeof Tavily === 'function'
          ? new Tavily({ apiKey: TAVILY_KEY })
          : Tavily({ apiKey: TAVILY_KEY })
      }
    }
  }
  return _tavilyClient
}
```

#### 建议 6: tavilySearch 丢失了 snippet/content 字段

```js
// L118: tavilySearch 只取 title 和 url
const items = result.results?.map(r => ({ title: r.title, url: r.url })) || []
```

对比 `clawSearch` (L76-78) 保留了 `snippet`:
```js
data.web.results.slice(0, 5).map(r => ({
  title: r.title, url: r.url, snippet: r.description || '',
}))
```

这导致 Tavily 返回时下游 AI 拿不到搜索结果摘要，信息质量明显下降。应当保留 `r.content` 或 `r.snippet`。

---

## 六、DuckDuckGo HTML 解析健壮性

### 6.1 当前实现

```js
async function duckduckgoSearch(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CyberClaw/1.0)' },
    signal: AbortSignal.timeout(15000),
  })
  const html = await response.text()
  const results = []
  const patterns = [
    /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
    /<a[^>]+data-testid="result-title-a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
    /<a[^>]+rel="nofollow"[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
  ]
  for (const regex of patterns) {
    let match
    while ((match = regex.exec(html)) !== null && results.length < 5) {
      const title = match[2].replace(/<[^>]+>/g, '').trim()
      if (title && !results.some(r => r.url === match[1]))
        results.push({ title, url: match[1] })
    }
    if (results.length >= 3) break
  }
  return results
}
```

### 6.2 问题分析

#### 问题 1: 三个后备正则不同程度地脆弱

| 正则 | 依赖的 HTML 特征 | 脆弱程度 |
|------|------------------|:--------:|
| `class="result__a"` | DDG 旧版 HTML 的 CSS class | 高 — DDG 改版即失效 |
| `data-testid="result-title-a"` | DDG 新版 HTML 的 testid 属性 | 中 — testid 相对稳定 |
| `rel="nofollow"` | 所有外链的通用属性 | 极高 — 会匹配到广告、侧栏等非搜索结果 |

第三个正则 `rel="nofollow"` 是最危险的兜底，它可能匹配到页面中任何外链（侧栏、标签、推荐等），而不仅限于搜索结果。

#### 问题 2: 无状态码检查

`fetch()` 返回后直接 `response.text()`，未检查 `response.ok`。如果 DDG 返回 403/429/503，代码会尝试用正则解析错误页面 HTML。

**建议**: 添加状态码检查：
```js
if (!response.ok) return []
```

#### 问题 3: 无 User-Agent 轮换

固定的 `User-Agent: 'Mozilla/5.0 (compatible; CyberClaw/1.0)'` 容易被 DDG 识别并限流。夸张地说，`CyberClaw/1.0` 这个标识反而容易被反爬系统识别。

**建议**: 使用更通用的 User-Agent，或实现简单的轮换。

#### 问题 4: DDG 可能返回 reCAPTCHA

当 DDG 检测到爬虫行为时，HTML 页面会包含验证码而非搜索结果。当前代码会静默返回空数组，跟 "无结果" 无法区分。

**建议**: 检测 CAPTCHA 特征：
```js
if (html.includes('g-recaptcha') || html.includes('captcha')) {
  return []  // 可选：记录警告日志
}
```

#### 问题 5: URL 未做协议/域名校验

正则捕获的 `href` 值可能是相对路径、协议相对 URL (`//example.com`)、或其他非预期格式。

**建议**: 添加 URL 规范化：
```js
function normalizeURL(raw, base = 'https://duckduckgo.com') {
  try {
    return new URL(raw, base).href
  } catch {
    return null
  }
}
```

#### 建议: 考虑使用 DuckDuckGo Instant Answer API

DDG 实际上提供 Instant Answer API: `https://api.duckduckgo.com/?q=keyword&format=json`，返回结构化 JSON 数据，比 HTML 解析可靠得多。虽然结果数量有限，但作为兜底方案足够，且无需担心 HTML 结构变化。

---

## 七、搜索脱敏审查

### 7.1 当前实现

```js
const SEARCH_SENSITIVE_PATTERNS = [
  /sk_live_/i, /sk_test_/i,             // Stripe API keys
  /pk_live_/i, /pk_test_/i,             // Stripe publishable keys
  /ghp_[a-zA-Z0-9]{36}/i,                // GitHub personal access token (classic)
  /github_pat_[a-zA-Z0-9_]{82}/i,       // GitHub fine-grained token
  /AKIA[A-Z0-9]{16}/,                   // AWS Access Key ID
  /DEEPSEEK_API_KEY|OPENAI_API_KEY|TAVILY_API_KEY|CONTEXTWIRE_API_KEY/i,  // 环境变量名
  /sk-[a-zA-Z0-9]{20,}/i,              // OpenAI/Anthropic API keys
  /-----BEGIN (RSA |OPENSSH )?PRIVATE KEY-----/i,  // Private keys
]
```

### 7.2 分析

#### 合理性评估

脱敏策略选择了 **黑名单拒绝** 而非 **白名单通过**。对于搜索场景来说，这个选择是正确的——宁可误杀，不可泄露。

#### 问题 1: `sk-[a-zA-Z0-9]{20,}` 可能误杀正常搜索

`sk-` 前缀的正则可能匹配到合法搜索词。例如：
- 搜索 "sk-learn tutorial"（scikit-learn 的缩写）
- 搜索 "SK-II 护肤品"
- 搜索 "SK hynix 财报"

**建议**: 将 OpenAI key 格式收紧为更精确的模式：
```js
/sk-(?:ant-)?[a-zA-Z0-9]{32,}/i   // OpenAI: sk-proj-xxx, Anthropic: sk-ant-xxx
```

#### 问题 2: 缺少对 URL 中 token 的检测

用户可能搜索包含敏感 token 的 URL，如：
- `https://api.example.com?token=ghp_xxx...`
- `https://example.com#access_token=sk-xxx`

当前没有任何模式匹配 URL 内嵌的 token。

**建议**: 添加对 URL 参数中 token 的检测：
```js
/[?&](?:token|key|secret|api_key|access_token|auth)=[a-zA-Z0-9_-]{20,}/i,
```

#### 问题 3: 环境变量名匹配过于宽泛

```js
/DEEPSEEK_API_KEY|OPENAI_API_KEY|TAVILY_API_KEY|CONTEXTWIRE_API_KEY/i
```

这个正则只匹配**变量名**本身，但正常搜索不会直接搜这些名字。然而，如果搜索的是 `.env` 文件内容或配置文档片段，仍然是有效的防护。

不过，它没有匹配对应的 **值** 部分。如果用户搜索的是 `DEEPSEEK_API_KEY=sk-xxxxx` 这类完整行，`sk-` 的规则会捕获，但如果值是其他格式（如纯 hex 字符串），就会漏过。

#### 问题 4: `sanitizeQuery` 返回 `{ blocked: true }` 但错误信息笼统

```js
if (p.test(query)) return { blocked: true }
```

所有拦截统一返回 "搜索查询包含疑似敏感信息，已拦截"，用户无法知道是哪个模式触发了拦截，排查困难。

**建议**: 记录触发的具体模式（服务端日志），并给用户更具体的提示：
```js
for (const p of SEARCH_SENSITIVE_PATTERNS) {
  if (p.test(query)) {
    console.warn(`[sanitize] 查询被拦截，匹配模式: ${p}`, query)
    return { blocked: true, reason: '搜索查询包含疑似敏感信息，已拦截' }
  }
}
```

### 7.3 总体评价

脱敏策略**总体合理，不算过于激进**。8 个模式覆盖了主要的 API Key / Token / 私钥泄露场景。与 "过于激进" 相反，当前的问题更偏向**覆盖不足**（缺少 URL token、JWT、Bearer token 等模式），而非误杀过多。

但对于 `sk-` 前缀的误杀风险仍需关注，建议收紧该正则。

---

## 八、其他发现

### 8.1 缺少重试机制

所有搜索函数（Claw/Serper/Tavily/DDG/CW）都没有重试逻辑。网络瞬时故障会导致直接跳入下一级降级链，而非在当前引擎重试。

**建议**: 添加简单的重试（最多 2 次，指数退避）：
```js
async function withRetry(fn, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const result = await fn()
      if (result && result.length > 0) return result
      if (i < retries) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)))
    } catch {
      if (i === retries) return []
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)))
    }
  }
  return []
}
```

### 8.2 `extractURL` 无 URL 校验

安全审查报告 (review-final-security.md) 已指出此问题。`extractURL(url)` 直接将用户输入的 URL 传给 Tavily SDK，无任何格式校验或 SSRF 防护。

**建议**: 添加基础的 URL 格式校验：
```js
function isValidURL(url) {
  try {
    const u = new URL(url)
    return ['http:', 'https:'].includes(u.protocol)
  } catch { return false }
}
```

### 8.3 ContextWire 缺少错误处理和结果格式校验

```js
async function contextwireSearch(query) {
  if (!CONTEXTWIRE_KEY) return []
  const cwMod = await import('@contextwire/sdk').catch(() => null)
  // ...
  const result = await client.search(query)
  return result.results?.map(r => ({ title: r.title, url: r.url })) || []
}
```

`@contextwire/sdk` 是 optionalDependency，且代码中没有 try-catch 包裹 `client.search(query)`。如果 SDK 抛出异常，会导致整个搜索流程崩溃，而非优雅降级。

**建议**: 包裹 try-catch：
```js
try {
  const result = await client.search(query)
  return result.results?.map(r => ({ title: r.title, url: r.url })) || []
} catch {
  return []
}
```

### 8.4 deep search 不返回 snippet

`tavilyDeepSearch()` 和 `tavilySearch()` 都只映射 `title` 和 `url`，丢弃了 `snippet`/`content` 字段 (L118, L133)。这在 deep 搜索场景下尤其浪费，因为 Tavily Deep Search 会额外爬取页面内容并提供更丰富的摘要。

### 8.5 缺少搜索来源标识的一致性

返回的 `source` 字段不一致：
- cache → `'cache'`
- Claw → `'claw_search'`
- Serper → `'serper'`
- Tavily → `'tavily'` / `'tavily_deep'`
- DDG → `'duckduckgo'`
- CW → `'contextwire'`

建议统一格式（如下划线/驼峰），方便下游解析。

---

## 九、改进优先级建议

| 优先级 | 项目 | 影响 | 工作量 |
|:------:|------|------|:------:|
| **P0 紧急** | 修复 Tavily 丢失 snippet/content 字段 | 搜索结果质量严重受损 | 小 (1 行) |
| **P0 紧急** | ContextWire 搜索添加 try-catch | 搜索流程可能崩溃 | 小 (2 行) |
| **P1 高** | deep模式支持降级而非直接返回 error | 深度搜索体验改善 | 中 |
| **P1 高** | 为搜索添加重试机制 | 减少不必要的降级 | 中 |
| **P2 中** | 调整降级链优先级 (Serper 优先) | 搜索质量提升 | 小 |
| **P2 中** | deep 模式添加缓存读写 | 减少 API 消耗 | 中 |
| **P2 中** | DDG 添加 reCAPTCHA 检测 | 兜底可靠性提升 | 小 |
| **P3 低** | LRU 改为真正最少使用淘汰 | 缓存命中率提升 | 小 |
| **P3 低** | Tavily 客户端单例化 | 减少对象创建开销 | 小 |
| **P4 改进** | 缓存持久化到磁盘 | 冷启动体验改善 | 中 |
| **P4 改进** | 并行竞速替代串行降级 | 延迟改善 | 大 |

---

## 十、结论

自由鸟 v4 的搜索系统在 **250 行内实现了一个完整的多引擎降级搜索方案**，代码简洁、职责清晰，体现了良好的工程直觉。但在细节上有若干可改进之处：

1. **串行降级链的思路正确，但引擎排序和失败处理需要调整** — 这是影响搜索质量的核心因素
2. **缓存基础架构可用，但实现粗糙** — 1 小时 TTL 合理，LRU 不精确可后续改进
3. **双模式设计意图好，但实现割裂** — deep 模式缺少缓存和降级是功能缺陷
4. **Tavily API 使用基本正确，参数可进一步优化**
5. **DDG HTML 解析是最脆弱的环节** — 建议迁移到 Instant Answer API
6. **搜索脱敏合理有效，不算过于激进**

**一句话总结**: 搜索基础设施骨架正确，修复 P0 和 P1 项后即可达到生产可用水平。
