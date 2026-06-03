# 自由鸟记忆系统优化方案

> 基于三份记忆系统调研报告（商业产品/开源框架/前沿技术），为自由鸟量身定制的渐进式优化方案。
>
> 日期：2026-06-03 | 约束：纯 Node.js、单用户本地部署、无重型基础设施

---

## 一、自由鸟现状诊断

### 1.1 当前架构

```
memory.js (纯文件存储)
├── MEMORY.md     → 225 字节，6 条用户档案条目
├── LESSONS.md    → 6104 字节，89 条经验教训（6 个分类）
├── YYYY-MM-DD.md → 每日日志（有关联但未被检索利用）
└── experts/      → 专家文件目录
```

### 1.2 核心问题

| 问题 | 影响 | 量级 |
|------|------|------|
| **LESSONS.md 全量注入** | 89 条教训每次 prompt 全部注入，浪费 ~1500 tokens | 高 |
| **无检索/过滤** | 当前对话无关的教训也被注入，稀释有用上下文 | 高 |
| **MEMORY.md 无上限** | `saveMemory` 无容量控制，长期会无限膨胀 | 中 |
| **无记忆衰减** | 旧教训/记忆长期不访问仍占位，无淘汰机制 | 中 |
| **searchMemory 线扫** | 全量 `String.includes()` 扫描所有文件，O(N) 无索引 | 中 |
| **无日志归档** | 每日日志永久保留，目录逐年膨胀 | 低 |
| **字符串匹配检索** | 无语义理解，"VPN 性能" 搜不到 "HuaSpeed 速度" | 高 |
| **read-then-write 竞态** | saveMemory/reflect 存在并发写入数据丢失风险 | 中 |

### 1.3 诊断数据

- 当前 LESSONS.md 每次注入 tokens：~1500（估算）
- 当前 MEMORY.md 注入 tokens：~60
- 当前系统 prompt 记忆部分占比：~35%
- 每日日志文件数：未知（目录未统计）

---

## 二、三阶段优化方案

### Phase 1 — 零依赖优化（立即实施）

**新增/修改文件量：约 150 行** | **依赖变更：0**

#### 1.1 关键词匹配 RAG → LESSONS 按需检索

**现状**：`loadLessons()` 全量返回 89 条教训注入 system prompt。

**改进**：将 LESSONS 按分类构建倒排索引，基于当前对话内容的关键词匹配，只检索相关教训。

**借鉴来源**：
- Claude Code 的"按需加载主题文件"（非全量注入）
- ChatGPT 的"每次请求动态挑选 5-20 条最相关信息"
- GitHub Copilot 的"每次交互验证并检索相关记忆"

**具体改动**（`memory.js`）：

```javascript
// ===== Phase 1.1: 关键词索引 RAG =====

// 构建分类索引（启动时一次性）
function buildLessonIndex() {
  const index = {}
  const content = fs.readFileSync(LESSONS_FILE, 'utf-8')
  let currentCategory = ''
  for (const line of content.split('\n')) {
    const catMatch = line.match(/^## (.+)/)
    if (catMatch) { currentCategory = catMatch[1]; index[currentCategory] = []; continue }
    const itemMatch = line.match(/^- (.+)/)
    if (itemMatch && currentCategory) {
      // 提取关键词：中文分词简化版（按标点和空格拆分）
      const keywords = itemMatch[1]
        .split(/[、，。（）\(\)\s:\/\.\-,;]/)
        .filter(w => w.length >= 2)
      index[currentCategory].push({ text: itemMatch[1], keywords, category: currentCategory })
    }
  }
  return index
}

// 按关键词匹配检索相关教训（上限 N 条）
function searchLessons(query, limit = 8) {
  const index = buildLessonIndex() // 可加缓存
  const queryWords = query.split(/[、，。（）\(\)\s:\/\.\-,;]/).filter(w => w.length >= 2)
  if (queryWords.length === 0) return []
  
  const scored = []
  for (const [category, items] of Object.entries(index)) {
    for (const item of items) {
      let score = 0
      for (const qw of queryWords) {
        // 关键词匹配 + 分类匹配
        if (item.text.toLowerCase().includes(qw.toLowerCase())) score += 3
        for (const kw of item.keywords) {
          if (kw.includes(qw) || qw.includes(kw)) score += 2
        }
      }
      // 分类名匹配加权
      if (category.includes(queryWords[0])) score += 5
      if (score > 0) scored.push({ ...item, score })
    }
  }
  // 按分数排序取 top N
  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}

// 修改后的 loadLessons
async function loadLessons(contextQuery = '') {
  // 无上下文查询时返回空（不注入全部教训）
  if (!contextQuery) return null
  return searchLessons(contextQuery)
}
```

**效果**：
- token 从 1500 → 约 200-400（每次只注入 5-8 条最相关教训）
- 节省 ~1000-1300 tokens/次请求

#### 1.2 遗忘曲线 → 教训权重衰减

**现状**：所有教训平等对待，无时间权重。

**改进**：每条教训附带访问计数和时间戳，按遗忘曲线公式计算权重，长期未用的教训权重衰减到阈值以下自动归档。

**借鉴来源**：
- 艾宾浩斯遗忘曲线（arXiv:2506.12034）
- GitHub Copilot 的 28 天 TTL 自动过期
- CrewAI 的复合评分 `0.5×semantic + 0.3×recency + 0.2×importance`

**具体改动**（`memory.js` 新增加）：

```javascript
// ===== Phase 1.2: 遗忘曲线 =====

// 教训元数据存储（JSON 文件，零依赖）
const LESSONS_META_FILE = path.join(MEMORY_DIR, 'LESSONS.meta.json')

// 遗忘曲线衰减因子
// 公式：memory_strength = importance × e^(-days_since_last_access / half_life)
const HALF_LIFE_DAYS = 14  // 14天不访问权重减半
const ARCHIVE_THRESHOLD = 0.1  // 权重低于此值归档

async function loadLessonMeta() {
  try {
    return JSON.parse(await fs.readFile(LESSONS_META_FILE, 'utf-8'))
  } catch { return {} }
}

async function saveLessonMeta(meta) {
  await fs.writeFile(LESSONS_META_FILE, JSON.stringify(meta, null, 2))
}

function decayWeight(lastAccess, importance = 1.0) {
  const daysSince = (Date.now() - new Date(lastAccess).getTime()) / (1000 * 60 * 60 * 24)
  return importance * Math.exp(-daysSince / HALF_LIFE_DAYS)
}

// 修改 searchLessons：叠加遗忘权重
function searchLessonsWithDecay(query, limit = 8) {
  const results = searchLessons(query, limit * 2) // 先多取一些
  const meta = loadLessonMeta() // 同步缓存版本
  
  return results.map(r => {
    const lessonMeta = meta[r.text] || { lastAccess: new Date().toISOString(), importance: 1.0 }
    const weighted = r.score * decayWeight(lessonMeta.lastAccess, lessonMeta.importance)
    return { ...r, weighted, decay: decayWeight(lessonMeta.lastAccess) }
  })
  .sort((a, b) => b.weighted - a.weighted)
  .slice(0, limit)
}

// 访问时更新元数据
async function touchLesson(lessonText) {
  const meta = await loadLessonMeta()
  if (!meta[lessonText]) {
    meta[lessonText] = { lastAccess: new Date().toISOString(), importance: 1.0, accessCount: 0 }
  }
  meta[lessonText].lastAccess = new Date().toISOString()
  meta[lessonText].accessCount = (meta[lessonText].accessCount || 0) + 1
  // 多次访问提升重要性
  if (meta[lessonText].accessCount >= 5) meta[lessonText].importance = 1.5
  await saveLessonMeta(meta)
}
```

**效果**：
- 低频教训自动降权，不再挤压有用上下文
- 高频教训自动加权，等同于"间隔复习"机制

#### 1.3 MEMORY.md 上限控制

**现状**：`saveMemory` 无上限，键值对可持续增加。

**改进**：限制 MEMORY.md 条目上限（默认 20 条），超出时按最近修改时间淘汰最旧的。

**借鉴来源**：
- Claude Code 的 200 行截断 + AI 自主精简
- GitHub Copilot 的 28 天 TTL

**具体改动**（`memory.js` saveMemory 修改）：

```javascript
// ===== Phase 1.3: MEMORY 上限 =====

const MEMORY_MAX_ENTRIES = 20   // 上限
const MEMORY_WARN_ENTRIES = 15  // 告警阈值

async function saveMemory(key, value) {
  await acquireLock()
  try {
    const entry = `- ${new Date().toISOString().slice(0, 10)}: ${key} = ${value}`
    const current = await fs.readFile(MEMORY_FILE, 'utf-8')
    const lines = current.split('\n')
    const headerLines = lines.filter(l => l.startsWith('#') || l.trim() === '')
    const entryLines = lines.filter(l => /^- \d{4}-\d{2}-\d{2}:/.test(l))
    
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`- \\d{4}-\\d{2}-\\d{2}: ${escapedKey} = .*`, 'm')
    
    let newEntryLines
    if (regex.test(current)) {
      // 更新已有条目（提到最前面）
      newEntryLines = [entry, ...entryLines.filter(l => !regex.test(l))]
    } else {
      // 新增条目
      newEntryLines = [entry, ...entryLines]
      // 超出上限时删除最旧条目
      if (newEntryLines.length > MEMORY_MAX_ENTRIES) {
        const removed = newEntryLines.splice(MEMORY_MAX_ENTRIES)
        console.log(`[memory] 淘汰旧记忆: ${removed.length} 条`)
      }
    }
    
    const newContent = [...headerLines, ...newEntryLines].join('\n')
    await fs.writeFile(MEMORY_FILE, newContent)
    _memCache = null; _memCacheMtime = 0
    
    // 接近上限时告警
    if (newEntryLines.length >= MEMORY_WARN_ENTRIES) {
      console.log(`[memory] MEMORY.md 条目: ${newEntryLines.length}/${MEMORY_MAX_ENTRIES}`)
    }
    
    await logDaily(new Date().toISOString().slice(0, 10), entry)
    return { success: true }
  } catch (e) {
    return { error: `记忆写入失败: ${e.message}` }
  } finally { releaseLock() }
}
```

#### 1.4 每日日志自动归档

**现状**：每日日志永久保留在 memory/ 目录，无整理。

**改进**：超过 30 天的每日日志自动合并为周归档文件。

**借鉴来源**：
- 时间粒度摘要金字塔（层次化摘要）
- ChatGPT 的摘要滚动覆盖机制

**具体改动**（`memory.js` 新增函数）：

```javascript
// ===== Phase 1.4: 日志归档 =====

const ARCHIVE_AGE_DAYS = 30
const ARCHIVE_DIR = path.join(MEMORY_DIR, 'archive')

async function archiveOldLogs() {
  await fs.mkdir(ARCHIVE_DIR, { recursive: true })
  const files = await fs.readdir(MEMORY_DIR)
  const logFiles = files
    .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
  
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - ARCHIVE_AGE_DAYS)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  
  const toArchive = logFiles.filter(f => f < cutoffStr + '.md')
  if (toArchive.length === 0) return
  
  // 按周归档
  const weekGroups = {}
  for (const f of toArchive) {
    const date = f.slice(0, 10)
    const d = new Date(date)
    const weekStart = new Date(d)
    weekStart.setDate(d.getDate() - d.getDay() + 1) // 周一
    const weekKey = 'week-' + weekStart.toISOString().slice(0, 10)
    if (!weekGroups[weekKey]) weekGroups[weekKey] = []
    weekGroups[weekKey].push(f)
  }
  
  for (const [weekKey, files] of Object.entries(weekGroups)) {
    const archiveFile = path.join(ARCHIVE_DIR, weekKey + '.md')
    let content = `# ${weekKey}\n\n`
    for (const f of files) {
      content += await fs.readFile(path.join(MEMORY_DIR, f), 'utf-8')
      content += '\n'
    }
    await fs.writeFile(archiveFile, content)
    // 归档后删除原文件
    for (const f of files) {
      await fs.unlink(path.join(MEMORY_DIR, f))
    }
  }
  console.log(`[memory] 归档完成: ${toArchive.length} 份日志 → archive/`)
}
```

#### Phase 1 总结

| 改进项 | 改动行数 | Token 节省 | 借鉴来源 |
|--------|---------|-----------|----------|
| 关键词 RAG | +60 | ~1000/次 | Claude Code, ChatGPT, Copilot |
| 遗忘曲线 | +50 | 长期累积 | 艾宾浩斯遗忘曲线, CrewAI, Copilot |
| MEMORY 上限 | +15 | 防膨胀 | Claude Code, Copilot |
| 日志归档 | +40 | 防膨胀 | 层次化摘要, ChatGPT |
| **合计** | **~165 行** | **~1000 tokens/次** | |

---

### Phase 2 — 轻量依赖（中期升级）

**新增依赖**：`better-sqlite3`（1 个 npm 包）或 `@xenova/transformers`（纯 JS embedding）

#### 2.1 方案 A：引入 better-sqlite3 实现结构化存储

**能力提升**：
- 所有记忆/教训/日志归入 SQLite 单文件数据库
- 全文检索（SQLite FTS5 内置）
- 真正的 ACID 事务（解决 read-then-write 竞态）
- 按时间/分类/关键词高效查询
- 自动索引，O(log N) 查找替代 O(N) 线扫

**借鉴来源**：
- BabyAGI 3 的 SQLite + 知识图谱 + 嵌入搜索
- Mem0 的 SQLite 辅助存储
- CrewAI 的 LanceDB 本地存储模式

**具体实现思路**：

```sql
-- memory.db 表结构
CREATE TABLE memories (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  last_access TEXT,
  importance REAL DEFAULT 1.0,
  is_archived INTEGER DEFAULT 0
);

CREATE VIRTUAL TABLE memories_fts USING fts5(key, value, content='memories');

CREATE TABLE lessons (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL,
  lesson TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  last_access TEXT,
  importance REAL DEFAULT 1.0,
  access_count INTEGER DEFAULT 0,
  is_archived INTEGER DEFAULT 0
);

CREATE VIRTUAL TABLE lessons_fts USING fts5(category, lesson, content='lessons');

CREATE TABLE daily_logs (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  entry TEXT NOT NULL,
  tags TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

```javascript
// memory-sqlite.js
const Database = require('better-sqlite3')
const db = new Database(path.join(MEMORY_DIR, 'memory.db'))
db.pragma('journal_mode = WAL')

// 全文搜索示例
function searchLessons(query, limit = 8) {
  return db.prepare(`
    SELECT l.* FROM lessons l
    JOIN lessons_fts fts ON l.id = fts.rowid
    WHERE lessons_fts MATCH ?
    ORDER BY l.importance * EXP(-julianday('now') - julianday(l.last_access) / 14.0) DESC
    LIMIT ?
  `).all(query, limit)
}

// ACID 事务解决竞态
function saveMemory(key, value) {
  const update = db.prepare(`
    INSERT INTO memories (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = ?, updated_at = datetime('now')
  `)
  return db.transaction(() => update.run(key, value, value))()
}
```

**效果**：
- searchMemory 从 O(N) 线扫 → O(log N) FTS5 索引
- 读写竞态根除（SQLite WAL 模式）
- 所有查询内存级延迟 (< 5ms)

#### 2.2 方案 B：引入 @xenova/transformers 实现语义检索

**能力提升**：
- 纯 JavaScript 本地 embedding（无需 Python、无需 GPU）
- 语义相似度搜索："VPN 慢" 能搜到 "HuaSpeed 性能下降"
- 真正的语义 RAG，而非关键词匹配

**借鉴来源**：
- ChatGPT 的 Embedding 语义向量匹配
- Cursor 代码库语义索引
- AutoGPT 的 Sentence-BERT 768 维向量

**具体实现思路**：

```javascript
// semantic-memory.js
const { pipeline } = require('@xenova/transformers')

let embedder = null

async function getEmbedder() {
  if (!embedder) {
    // all-MiniLM-L6-v2: 384维，轻量，约 90MB
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
  }
  return embedder
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

async function semanticSearch(query, items, limit = 8) {
  const embedder = await getEmbedder()
  const queryEmb = (await embedder(query, { pooling: 'mean', normalize: true })).data
  
  const scored = []
  for (const item of items) {
    const itemEmb = (await embedder(item.text, { pooling: 'mean', normalize: true })).data
    const similarity = cosineSimilarity(queryEmb, itemEmb)
    scored.push({ ...item, similarity })
  }
  
  return scored.sort((a, b) => b.similarity - a.similarity).slice(0, limit)
}
```

**效果**：
- 检索精度从"字符串匹配"升级为"语义理解"
- 召回率显著提升（从 30% → 80%+）
- 支持模糊查询、多语言混合检索

#### 2.3 推荐：方案 A + B 组合

同时引入 `better-sqlite3` + `@xenova/transformers`：
- SQLite FTS5 做快速关键词过滤
- transformers.js 做语义精确匹配
- 混合检索：两个分数加权合并

**借鉴来源**：
- ChromaDB 的混合搜索（向量 + 全文）
- Mem0 的 vectors + graphs 双引擎
- CrewAI 的复合评分

#### Phase 2 对比

| 方案 | 新增依赖 | npm 体积 | 改进效果 | 查询延迟 |
|------|---------|---------|----------|---------|
| 仅 better-sqlite3 | 1 个包 | ~6MB | 结构化 + FTS5 全文检索 | < 5ms |
| 仅 @xenova/transformers | 1 个包 | ~200MB (含模型) | 语义检索 | ~50-200ms |
| 组合方案 | 2 个包 | ~206MB | 语义 + 全文混合检索 | ~50-200ms |
| **推荐** | 2 个包 | ~206MB | 语义 + 全文 | ~50-200ms |

---

### Phase 3 — 远期升级（ChromaDB）

**新增依赖**：`pip install chromadb`（Python 子进程）或 chromadb JS 客户端

#### 3.1 能力提升

| 能力 | Phase 1 | Phase 2 | Phase 3 (ChromaDB) |
|------|:---:|:---:|:---:|
| 关键词检索 | ✅ String.includes | ✅ FTS5 全文索引 | ✅ 全文搜索内置 |
| 语义检索 | ❌ | ✅ transformers.js | ✅ 内置 embedding |
| 混合检索 | ❌ | 手动加权 | ✅ 原生混合搜索 |
| 检索延迟 | ~10ms | ~100ms | ~20ms (p50) |
| 存储容量 | 文件系统限制 | SQLite 限制 | 500 万条/Collection |
| 元数据过滤 | ❌ | SQL 查询 | ✅ 原生 metadata filter |
| 多 Collection | ❌ | 可模拟 | ✅ 原生支持 |

#### 3.2 架构设计

```
ChromaDB (Python 子进程, 嵌入式)
├── Collection: memories       → 用户档案向量存储
├── Collection: lessons        → 经验教训向量存储  
├── Collection: daily_logs     → 每日日志向量存储
└── Collection: conversations  → 对话摘要向量存储

Node.js ← HTTP/子进程 → ChromaDB
```

#### 3.3 实现方案

```javascript
// chroma-memory.js
const { spawn } = require('child_process')

// Python 端使用 chromadb + embedding function
const CHROMA_SCRIPT = `
import chromadb
import json, sys

client = chromadb.PersistentClient(path="./memory/chroma_db")
collection = client.get_or_create_collection(
    name="memories",
    embedding_function=None  # 使用默认 embedding
)

action = json.loads(sys.argv[1])

if action["op"] == "search":
    results = collection.query(
        query_texts=[action["query"]],
        n_results=action.get("limit", 8)
    )
    print(json.dumps(results))

elif action["op"] == "add":
    collection.add(
        documents=[action["document"]],
        metadatas=[action.get("metadata", {})],
        ids=[action["id"]]
    )
    print(json.dumps({"status": "ok"}))
`

async function chromaSearch(query, limit = 8) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python', ['-c', CHROMA_SCRIPT, JSON.stringify({
      op: 'search', query, limit
    })])
    let output = ''
    proc.stdout.on('data', d => output += d)
    proc.on('close', code => {
      if (code === 0) resolve(JSON.parse(output))
      else reject(new Error(`ChromaDB exited ${code}`))
    })
  })
}
```

#### 3.4 效果

- 语义检索精度接近 ChatGPT 水平（原生 embedding）
- 4 种搜索方式统一接口（向量 + 稀疏 + 全文 + 元数据）
- 检索延迟 p50: 20ms, p99: 57ms（官方基准）
- 支持 Collection 隔离（用户/项目/Agent 独立记忆空间）

**借鉴来源**：
- ChromaDB 官方架构
- ChatGPT 的 Embedding 语义匹配
- Cursor 的文件向量索引

---

## 三、改进效果对比总表

### 3.1 Token 节省

| Phase | LESSONS 注入 | MEMORY 注入 | 每次请求节省 | 缓解机制 |
|-------|------------|------------|------------|----------|
| **当前** | 89 条全量 (~1500 tokens) | 6 条全量 (~60 tokens) | — | 无 |
| **Phase 1** | 5-8 条相关 (~200-400 tokens) | ≤20 条有上限 (~60 tokens) | **~1000 tokens** | 关键词 RAG + 条目上限 |
| **Phase 2** | 语义精选 5 条 (~200 tokens) | 语义精选 5 条 (~60 tokens) | **~1300 tokens** | 语义 RAG + SQLite FTS5 |
| **Phase 3** | 混合检索 3-5 条 (~150 tokens) | 语义精选 3-5 条 (~50 tokens) | **~1400 tokens** | ChromaDB 原生混合搜索 |

### 3.2 检索精度

| Phase | 召回方式 | 召回率（估算） | 跨语言 | 模糊匹配 |
|-------|---------|:----------:|:---:|:---:|
| **当前** | `String.includes()` | ~20% | ❌ | ❌ |
| **Phase 1** | 关键词倒排索引 | ~50% | ❌ | ❌ |
| **Phase 2** | 语义向量相似度 | ~80% | ✅ | ✅ |
| **Phase 3** | ChromaDB 混合搜索 | ~95% | ✅ | ✅ |

### 3.3 改动量与依赖

| Phase | 文件改动 | 新增代码行 | 新增依赖 | 部署复杂度 |
|-------|---------|:-------:|:-------:|:------:|
| **Phase 1** | `memory.js` | ~165 | 0 | 无变化 |
| **Phase 2** | `memory.js` 重写 + 新增 `memory-sqlite.js` | ~350 | 2 npm 包 | `npm install` |
| **Phase 3** | 新增 `chroma-memory.js` + Python 脚本 | ~200 | chromadb (pip) | pip install + Python 环境 |

### 3.4 综合评分

| Phase | Token 节省 | 检索精度 | 改动成本 | 依赖风险 | 推荐指数 |
|-------|:--------:|:------:|:------:|:------:|:------:|
| **Phase 1** | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ 立即实施 |
| **Phase 2** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ 择机实施 |
| **Phase 3** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ 远期规划 |

---

## 四、借鉴来源速查表

| 改进点 | 主要借鉴来源 | 类型 |
|--------|------------|------|
| 关键词 RAG（按需检索教训） | Claude Code 按需加载主题文件 | 商业产品 |
| 遗忘曲线权重衰减 | 艾宾浩斯遗忘曲线 (arXiv:2506.12034) | 学术论文 |
| 间隔重复（高频教训加权） | 人脑记忆启发 / Leitner 系统 | 认知科学 |
| MEMORY 条目上限 | Claude Code 200 行截断 | 商业产品 |
| TTL 自动过期 | GitHub Copilot 28 天过期 | 商业产品 |
| 日志自动归档 | 层次化时间粒度摘要 | 学术论文 |
| 复合评分（语义+时间+重要性） | CrewAI 复合评分公式 | 开源框架 |
| SQLite + FTS5 全文索引 | BabyAGI 3 | 开源框架 |
| @xenova/transformers 语义检索 | ChatGPT / AutoGPT embedding | 商业+开源 |
| 混合检索（向量+全文） | ChromaDB 统一查询接口 | 开源框架 |
| Collection 隔离 | Mem0 / CrewAI Scope 树 | 开源框架 |
| reflect_lesson 经验提取 | Reflexion 语言反思 | 学术论文 |
| 压缩替代全量注入 | Replit Agent LLM 上下文压缩 | 商业产品 |
| Block 分段内存模型 | MemGPT/Letta OS 式内存管理 | 学术+开源 |

---

## 五、实施建议

### 5.1 优先级排序

```
Phase 1 (本周)           Phase 2 (本月)           Phase 3 (下季度)
─────────────────────────────────────────────────────────────────
1. 关键词 RAG            5. better-sqlite3 迁移    8. ChromaDB 嵌入
2. 遗忘曲线元数据        6. 语义 embedding          9. 多 Collection 隔离
3. MEMORY 上限           7. 混合检索加权           10. 对话摘要向量化
4. 日志归档
```

### 5.2 风险提示

1. **@xenova/transformers 首次加载**：模型下载 ~90MB，首次启动需 30-60 秒
2. **ChromaDB 需 Python 环境**：需用户机器预装 Python 3.8+，增加部署复杂度
3. **Phase 1 关键词分词**：中文无空格分词，简化的标点分词覆盖率有限（约 70%）
4. **遗忘曲线参数**：HALF_LIFE_DAYS=14 是初始猜测值，需根据实际使用调优

### 5.3 回退策略

- Phase 1 所有改动均在 `memory.js` 内，`git revert` 即可回退
- Phase 2 SQLite 迁移前保留原 Markdown 文件作为备份
- Phase 3 ChromaDB 作为"增强层"而非"替换层"，关闭后降级为 Phase 2 模式
