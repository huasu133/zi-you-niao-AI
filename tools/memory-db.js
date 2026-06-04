// Phase 2: SQLite 记忆引擎（sql.js + embedding 语义检索）
const path = require('path')
const fs = require('fs')

const MEMORY_DIR = path.join(__dirname, '..', 'memory')
const DB_PATH = path.join(MEMORY_DIR, 'memory.db')
const LESSONS_FILE = path.join(MEMORY_DIR, 'LESSONS.md')
const MEMORY_FILE = path.join(MEMORY_DIR, 'MEMORY.md')

let _db = null
let _initDone = false

async function getDB() {
  if (_db) return _db
  const initSqlJs = require('sql.js')
  const SQL = await initSqlJs()
  try {
    const buffer = fs.readFileSync(DB_PATH)
    _db = new SQL.Database(buffer)
  } catch {
    _db = new SQL.Database()
  }
  _db.run(`CREATE TABLE IF NOT EXISTS lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    lesson TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    access_count INTEGER DEFAULT 0,
    last_access TEXT
  )`)
  _db.run(`CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  )`)
  if (!_initDone) {
    await syncFromFiles()
    _initDone = true
  }
  return _db
}

function saveDB() {
  if (!_db) return
  const data = _db.export()
  fs.writeFileSync(DB_PATH, Buffer.from(data))
}

async function syncFromFiles() {
  const cnt = _db.exec('SELECT COUNT(*) as c FROM lessons')
  if (cnt.length > 0 && cnt[0].values[0][0] > 0) return
  try {
    const content = fs.readFileSync(LESSONS_FILE, 'utf-8')
    const sections = content.split('\n## ')
    for (const section of sections) {
      const lines = section.split('\n')
      const category = lines[0].replace(/^## /, '').trim()
      if (!category || category === '经验教训') continue
      for (const line of lines.slice(1)) {
        if (line.startsWith('- ')) {
          const lesson = line.slice(2).trim()
          if (lesson) {
            _db.run('INSERT INTO lessons (category, lesson) VALUES (?, ?)', [category, lesson])
          }
        }
      }
    }
    saveDB()
    const newCnt = _db.exec('SELECT COUNT(*) FROM lessons')
    console.log(`SQLite 迁移: ${newCnt[0].values[0][0]} 条教训`)
  } catch (_) {}
}

// Embedding 语义搜索
let _embedder = null

async function getEmbedder() {
  if (!_embedder) {
    try {
      const { pipeline } = await import('@xenova/transformers')
      _embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
    } catch (_) { _embedder = 'unavailable' }
  }
  return _embedder === 'unavailable' ? null : _embedder
}

async function embed(text) {
  try {
    const pipe = await getEmbedder()
    if (!pipe) return null
    const result = await pipe(text, { pooling: 'mean', normalize: true })
    return Array.from(result.data)
  } catch (_) { return null }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// 关键词提取（Phase 1 保留）
const LESSON_CATEGORIES = {
  '前端': { kw: ['前端', 'UI', 'CSS', 'HTML', 'XSS', 'SSE', '渲染', '动画', '按钮', '输入', '响应式', '暗色', '移动端', 'viewport', 'font'], score: 1 },
  '后端': { kw: ['后端', '服务器', '路由', 'API', 'SSE', '工具', 'handler', 'schema', 'express', 'node', '竞态', '并发', '同步', '异步'], score: 1 },
  '安全': { kw: ['安全', '认证', 'Token', '密钥', '注入', 'SSRF', '遍历', '脱敏', '权限', '确认', '速率', '攻击'], score: 1 },
  'DevOps': { kw: ['部署', '打包', 'Electron', 'electron', '启动', '快捷', '自启', '进程', '守护', 'pm2', '窗口', '图标'], score: 1 },
  '搜索': { kw: ['搜索', '降级', 'Serper', 'Tavily', 'DDG', 'Claw', '缓存', 'snippet', 'fetchUrl', '引擎'], score: 1 },
  '内存': { kw: ['内存', '记忆', '存储', '文件', '缓存', '写入', '读取', 'I/O', '持久化', '锁', '竞态', '归档'], score: 1 },
  'Prompt': { kw: ['Prompt', '提示词', '灵魂', 'system', '指令', 'soul', '身份', '语气', '角色', '反思', 'reflect', '教训'], score: 1 },
  '专家调度': { kw: ['专家', '调度', 'Router', '路由', '团队', '多Agent', '协作'], score: 1 },
}

function extractKeywords(text) {
  const lower = (text || '').toLowerCase()
  const matched = new Set()
  for (const [cat, info] of Object.entries(LESSON_CATEGORIES)) {
    const hits = info.kw.filter(k => lower.includes(k.toLowerCase())).length
    if (hits > 0) matched.add(cat)
  }
  return matched.size > 0 ? [...matched] : Object.keys(LESSON_CATEGORIES)
}

// 艾宾浩斯遗忘曲线
let _lessonAccess = {}
let _lessonLastAccess = {}

function ebbinghausDecay(category) {
  const elapsed = (Date.now() - (_lessonLastAccess[category] || 0)) / (1000 * 60 * 60)
  const accessCount = _lessonAccess[category] || 0
  if (accessCount === 0) return 0
  return accessCount / (1 + 0.3 * Math.log(1 + elapsed))
}

// 混合搜索：关键词预筛 + embedding 语义排序
async function hybridSearch(query, topK = 5) {
  const db = await getDB()
  const categories = extractKeywords(query)

  // Step 1: 关键词过滤
  const catPlaceholders = categories.map(() => '?').join(',')
  const rows = db.exec(`SELECT id, category, lesson, access_count FROM lessons WHERE category IN (${catPlaceholders})`, categories)
  if (rows.length === 0 || rows[0].values.length === 0) return []

  const candidates = rows[0].values.map(r => ({
    id: r[0], category: r[1], lesson: r[2], accessCount: r[3] || 0
  }))

  // Step 2: embedding 语义排序
  const queryVec = await embed(query)
  const scored = []

  for (const row of candidates) {
    let score = 0
    if (queryVec) {
      const rowVec = await embed(row.lesson)
      const sim = rowVec ? cosineSimilarity(queryVec, rowVec) : 0
      score = sim * 0.7 + Math.min((row.accessCount || 0) / 10, 1) * 0.3
    } else {
      // 无 embedding：纯关键词 + 访问计数
      const catHits = categories.filter(c => row.category === c).length
      score = catHits * 0.6 + Math.min((row.accessCount || 0) / 10, 1) * 0.4
    }
    scored.push({ ...row, score })
  }

  // Step 3: 更新访问计数
  const sorted = scored.sort((a, b) => b.score - a.score).slice(0, topK)
  for (const row of sorted) {
    db.run('UPDATE lessons SET access_count = access_count + 1, last_access = datetime("now") WHERE id = ?', [row.id])
    if (row.category) {
      _lessonAccess[row.category] = (_lessonAccess[row.category] || 0) + 1
      _lessonLastAccess[row.category] = Date.now()
    }
  }
  saveDB()
  return sorted
}

// 加载教训（混合搜索 + 全量回退）
async function loadLessons(query) {
  try {
    const db = await getDB()
    if (!query) { // 全量返回（兼容旧调用）
      const rows = db.exec('SELECT category, lesson FROM lessons ORDER BY category, access_count DESC')
      if (rows.length === 0) return ''
      const grouped = {}
      for (const r of rows[0].values) {
        if (!grouped[r[0]]) grouped[r[0]] = []
        grouped[r[0]].push(`- ${r[1]}`)
      }
      let result = ''
      for (const [cat, lessons] of Object.entries(grouped)) {
        result += `\n## ${cat}\n${lessons.join('\n')}\n`
      }
      return result.trim()
    }

    const results = await hybridSearch(query, 5)
    if (results.length === 0) return ''

    const grouped = {}
    for (const row of results) {
      if (!grouped[row.category]) grouped[row.category] = []
      grouped[row.category].push(`- ${row.lesson}`)
    }
    let result = ''
    for (const [cat, lessons] of Object.entries(grouped)) {
      result += `\n## ${cat}\n${lessons.join('\n')}\n`
    }
    return result.trim()
  } catch (e) {
    console.error('loadLessons error:', e.message)
    return '' // 降级
  }
}

// 记忆 CRUD（SQLite + 文件同步）
async function saveMemory(key, value) {
  try {
    const db = await getDB()
    db.run('INSERT OR REPLACE INTO memories (key, value, updated_at) VALUES (?, ?, datetime("now"))', [key, value])
    saveDB()
    // 同步 MARKDOWN
    syncMemoryToFile(db)
    return { success: true }
  } catch (e) { return { error: `记忆写入失败: ${e.message}` } }
}

async function loadMemory() {
  try {
    const db = await getDB()
    const rows = db.exec('SELECT key, value, updated_at FROM memories ORDER BY updated_at DESC LIMIT 20')
    if (rows.length === 0) return '# 关于用户\n\n'
    let content = '# 关于用户\n\n'
    for (const r of rows[0].values) {
      content += `- ${r[2] || ''}: ${r[0]} = ${r[1]}\n`
    }
    return content
  } catch (_) { return '# 关于用户\n\n' }
}

async function reflect(category, lesson) {
  try {
    const db = await getDB()
    db.run('INSERT INTO lessons (category, lesson) VALUES (?, ?)', [category, lesson])
    saveDB()
    syncLessonsToFile(db)
    return { success: true }
  } catch (e) { return { error: `反思记录失败: ${e.message}` } }
}

// 搜索记忆
async function searchMemory(query) {
  try {
    const db = await getDB()
    const rows = db.exec(`SELECT key, value, updated_at FROM memories WHERE key LIKE ? OR value LIKE ? ORDER BY updated_at DESC LIMIT 20`,
      [`%${query}%`, `%${query}%`])
    if (rows.length === 0) return []
    return rows[0].values.map(r => ({ source: 'memory.db', content: `${r[0]}: ${r[1]}` }))
  } catch (_) { return [] }
}

// 文件同步
function syncLessonsToFile(db) {
  try {
    const rows = db.exec('SELECT category, lesson FROM lessons ORDER BY category, access_count DESC')
    const grouped = {}
    for (const r of rows[0].values) {
      if (!grouped[r[0]]) grouped[r[0]] = []
      grouped[r[0]].push(`- ${r[1]}`)
    }
    let content = '# 经验教训\n\n记录 AI 从错误中总结的经验，供后续参考。\n'
    for (const [cat, lessons] of Object.entries(grouped)) {
      content += `\n## ${cat}\n${lessons.join('\n')}\n`
    }
    fs.writeFileSync(LESSONS_FILE, content)
  } catch (_) {}
}

function syncMemoryToFile(db) {
  try {
    const rows = db.exec('SELECT key, value, updated_at FROM memories ORDER BY updated_at DESC LIMIT 20')
    let content = '# 关于用户\n\n'
    for (const r of rows[0].values) {
      content += `- ${r[2] || ''}: ${r[0]} = ${r[1]}\n`
    }
    fs.writeFileSync(MEMORY_FILE, content)
  } catch (_) {}
}

// 日志归档（Phase 1 保留）
async function archiveOldLogs() {
  try {
    const archiveDir = path.join(MEMORY_DIR, 'archive')
    fs.mkdirSync(archiveDir, { recursive: true })
    const files = fs.readdirSync(MEMORY_DIR)
    const dailyFiles = files.filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    for (const file of dailyFiles) {
      const fileDate = new Date(file.slice(0, 10))
      if (fileDate.getTime() < thirtyDaysAgo) {
        const month = file.slice(0, 7)
        const monthFile = path.join(archiveDir, `${month}.md`)
        const content = fs.readFileSync(path.join(MEMORY_DIR, file), 'utf-8')
        try { fs.accessSync(monthFile) } catch { fs.writeFileSync(monthFile, `# ${month}\n\n`) }
        fs.appendFileSync(monthFile, content + '\n')
        fs.unlinkSync(path.join(MEMORY_DIR, file))
      }
    }
  } catch (_) {}
}

setInterval(archiveOldLogs, 60 * 60 * 1000)

module.exports = {
  loadMemory, loadLessons, saveMemory, searchMemory, reflect, archiveOldLogs,
  getDB, // 供未来扩展
  name: 'memory',
  description: '用户记忆系统 Phase2：SQLite + embedding 语义检索',
}
