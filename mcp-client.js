require('dotenv').config()
const SERPER_KEY = process.env.SERPER_API_KEY
const TAVILY_KEY = process.env.TAVILY_API_KEY
const CONTEXTWIRE_KEY = process.env.CONTEXTWIRE_API_KEY

// 搜索缓存：同关键词 1 小时内不重复请求
const SEARCH_CACHE = {}
const CACHE_TTL = 3600 * 1000
const MAX_CACHE_SIZE = 200

// 搜索查询脱敏
const SEARCH_SENSITIVE_PATTERNS = [
  /sk_live_/i, /sk_test_/i,
  /pk_live_/i, /pk_test_/i,
  /ghp_[a-zA-Z0-9]{36}/i,
  /github_pat_[a-zA-Z0-9_]{82}/i,
  /AKIA[A-Z0-9]{16}/,
  /DEEPSEEK_API_KEY|OPENAI_API_KEY|TAVILY_API_KEY|CONTEXTWIRE_API_KEY/i,
  /sk-[a-zA-Z0-9]{20,}/i,
  /-----BEGIN (RSA |OPENSSH )?PRIVATE KEY-----/i,
]

function sanitizeQuery(query) {
  for (const p of SEARCH_SENSITIVE_PATTERNS) {
    if (p.test(query)) return { blocked: true }
  }
  return { blocked: false }
}

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

// DuckDuckGo
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

// Claw Search
async function clawSearch(query) {
  const url = `https://www.claw-search.com/api/search?q=${encodeURIComponent(query)}`
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) return []
  const data = await response.json()
  if (!data.web?.results?.length) return []
  return data.web.results.slice(0, 5).map(r => ({
    title: r.title, url: r.url, snippet: r.description || '',
  }))
}

// Serper.dev
async function serperSearch(query) {
  if (!SERPER_KEY) return []
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 5 }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return []
    const data = await res.json()
    return data.organic?.slice(0, 5).map(r => ({
      title: r.title, url: r.link, snippet: r.snippet || '',
    })) || []
  } catch { return [] }
}

// Tavily 懒加载
let _tavilyMod = null
async function getTavilyMod() {
  if (_tavilyMod === null) {
    _tavilyMod = await import('@tavily/core').catch(() => undefined)
  }
  return _tavilyMod
}

async function tavilySearch(query) {
  if (!TAVILY_KEY) return []
  const tavilyMod = await getTavilyMod()
  if (!tavilyMod) return []
  const Tavily = tavilyMod.default || tavilyMod.Tavily || tavilyMod.tavily
  if (!Tavily) return []
  const client = typeof Tavily === 'function' ? new Tavily({ apiKey: TAVILY_KEY }) : Tavily({ apiKey: TAVILY_KEY })
  const result = await client.search(query, {
    searchDepth: 'basic', maxResults: 10, includeAnswer: true,
  })
  const items = result.results?.map(r => ({ title: r.title, url: r.url, snippet: r.snippet || r.content || '' })) || []
  if (result.answer) items.unshift({ title: 'AI 总结', url: '', summary: result.answer })
  return items
}

async function tavilyDeepSearch(query) {
  if (!TAVILY_KEY) return []
  const tavilyMod = await getTavilyMod()
  if (!tavilyMod) return []
  const Tavily = tavilyMod.default || tavilyMod.Tavily || tavilyMod.tavily
  if (!Tavily) return []
  const client = typeof Tavily === 'function' ? new Tavily({ apiKey: TAVILY_KEY }) : Tavily({ apiKey: TAVILY_KEY })
  const result = await client.search(query, {
    searchDepth: 'deep', maxResults: 10, includeAnswer: true,
  })
  const items = result.results?.map(r => ({ title: r.title, url: r.url, snippet: r.snippet || r.content || '' })) || []
  if (result.answer) items.unshift({ title: 'AI 总结', url: '', summary: result.answer })
  return items
}

// ContextWire
async function contextwireSearch(query) {
  if (!CONTEXTWIRE_KEY) return []
  try {
    const cwMod = await import('@contextwire/sdk').catch(() => null)
    if (!cwMod) return []
    const ContextWire = cwMod.default || cwMod.ContextWire
    if (!ContextWire) return []
    const client = typeof ContextWire === 'function' ? new ContextWire(CONTEXTWIRE_KEY) : ContextWire(CONTEXTWIRE_KEY)
    const result = await client.search(query)
    return result.results?.map(r => ({ title: r.title, url: r.url })) || []
  } catch { return [] }
}

// 双模式
let currentSearchMode = 'basic'
function setSearchMode(mode) { currentSearchMode = mode }
function getSearchMode() { return currentSearchMode }

// 主搜索
async function searchWeb(query) {
  const check = sanitizeQuery(query)
  if (check.blocked) return { error: '搜索查询包含疑似敏感信息，已拦截' }

  if (currentSearchMode === 'basic') {
    const cached = SEARCH_CACHE[query]
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      return { results: cached.results, source: 'cache', cached: true }
    }
  }

  if (currentSearchMode === 'deep' && TAVILY_KEY) {
    const tv = await tavilyDeepSearch(query).catch(() => [])
    if (tv.length > 0) return { results: tv, source: 'tavily_deep' }
    return { error: '深度搜索无结果，请尝试换关键词或切换回快速模式' }
  }

  // basic: Claw → Serper → Tavily → DDG → CW
  const claw = await clawSearch(query).catch(() => [])
  if (claw.length > 0) {
    SEARCH_CACHE[query] = { results: claw, time: Date.now() }; trimCache()
    return { results: claw, source: 'claw_search' }
  }
  const serper = await serperSearch(query).catch(() => [])
  if (serper.length > 0) {
    SEARCH_CACHE[query] = { results: serper, time: Date.now() }; trimCache()
    return { results: serper, source: 'serper' }
  }
  const tv = await tavilySearch(query).catch(() => [])
  if (tv.length > 0) {
    SEARCH_CACHE[query] = { results: tv, time: Date.now() }; trimCache()
    return { results: tv, source: 'tavily' }
  }
  const ddg = await duckduckgoSearch(query).catch(() => [])
  if (ddg.length > 0) {
    SEARCH_CACHE[query] = { results: ddg, time: Date.now() }; trimCache()
    return { results: ddg, source: 'duckduckgo' }
  }
  const cw = await contextwireSearch(query).catch(() => [])
  if (cw.length > 0) {
    SEARCH_CACHE[query] = { results: cw, time: Date.now() }; trimCache()
    return { results: cw, source: 'contextwire' }
  }
  return { error: '搜索无结果，请尝试换关键词' }
}

async function deepSearchWeb(query) {
  const check = sanitizeQuery(query)
  if (check.blocked) return { error: '搜索查询包含疑似敏感信息，已拦截' }
  if (TAVILY_KEY) {
    const tv = await tavilyDeepSearch(query).catch(() => [])
    if (tv.length > 0) return { results: tv, source: 'tavily_deep' }
  }
  const serper = await serperSearch(query).catch(() => [])
  if (serper.length > 0) return { results: serper, source: 'serper' }
  const claw = await clawSearch(query).catch(() => [])
  if (claw.length > 0) return { results: claw, source: 'claw_search' }
  const ddg = await duckduckgoSearch(query).catch(() => [])
  if (ddg.length > 0) return { results: ddg, source: 'duckduckgo' }
  return { error: '搜索无结果，请尝试换关键词' }
}

async function extractURL(url) {
  if (TAVILY_KEY) {
    const tavilyMod = await getTavilyMod()
    if (tavilyMod) {
      const Tavily = tavilyMod.default || tavilyMod.Tavily || tavilyMod.tavily
      if (Tavily) return await (typeof Tavily === 'function' ? new Tavily({ apiKey: TAVILY_KEY }) : Tavily({ apiKey: TAVILY_KEY })).extract(url)
    }
  }
  return { error: '未配置 TAVILY_API_KEY，无法使用页面提取' }
}

async function research(topic) {
  const check = sanitizeQuery(topic)
  if (check.blocked) return { error: '研究主题包含疑似敏感信息，已拦截' }
  if (TAVILY_KEY) {
    const tavilyMod = await getTavilyMod()
    if (tavilyMod) {
      const Tavily = tavilyMod.default || tavilyMod.Tavily || tavilyMod.tavily
      if (Tavily) return await (typeof Tavily === 'function' ? new Tavily({ apiKey: TAVILY_KEY }) : Tavily({ apiKey: TAVILY_KEY })).research(topic)
    }
  }
  return { error: '未配置 TAVILY_API_KEY，无法使用深度研究' }
}

module.exports = {
  searchWeb, deepSearchWeb, extractURL, research, setSearchMode, getSearchMode,
  name: 'search_client',
  description: '搜索客户端：Claw Search主搜 + Serper(Google) + Tavily(快速/深度) + DDG/CW兜底',
}
