// Phase 3: ChromaDB 混合搜索引擎
// 通过 Python chroma run 子进程 + REST API 通信
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const MEMORY_DIR = path.join(__dirname, '..', 'memory')
const CHROMA_DIR = path.join(MEMORY_DIR, 'chromadb')
const CHROMA_PORT = 8001
const CHROMA_URL = `http://127.0.0.1:${CHROMA_PORT}`
const PYTHON = 'C:/Users/song/.workbuddy/binaries/python/versions/3.13.12/python.exe'

let _dbReady = false
let _dbInitPromise = null

// 启动 ChromaDB 服务
async function startChromaDB() {
  if (_dbReady) return
  if (_dbInitPromise) return _dbInitPromise

  _dbInitPromise = new Promise((resolve, reject) => {
    fs.mkdirSync(CHROMA_DIR, { recursive: true })
    
    const proc = spawn(PYTHON, ['-m', 'chromadb', 'run', '--path', CHROMA_DIR, '--port', String(CHROMA_PORT)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let started = false
    const timeout = setTimeout(() => {
      if (!started) reject(new Error('ChromaDB 启动超时'))
    }, 15000)

    proc.stderr.on('data', (data) => {
      const text = data.toString()
      if (text.includes('Uvicorn running') || text.includes('Application startup complete')) {
        started = true
        clearTimeout(timeout)
        _dbReady = true
        resolve()
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    proc.on('exit', (code) => {
      if (!started) {
        clearTimeout(timeout)
        reject(new Error(`ChromaDB 退出: ${code}`))
      }
    })

    // 后台保活
    globalThis._chromaProc = proc
  })

  return _dbInitPromise
}

// REST API 封装
async function chromaAPI(method, endpoint, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body) opts.body = JSON.stringify(body)
  
  const res = await fetch(`${CHROMA_URL}${endpoint}`, opts)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`ChromaDB ${method} ${endpoint}: ${res.status} ${text}`)
  }
  return res.json()
}

// 获取或创建 collection
async function getCollection() {
  try {
    const collections = await chromaAPI('GET', '/api/v2/collections')
    const existing = collections.find(c => c.name === 'ziyouniao_lessons')
    if (existing) return existing.id
  } catch (_) {}

  const created = await chromaAPI('POST', '/api/v2/collections', {
    name: 'ziyouniao_lessons',
    metadata: { description: '自由鸟经验教训' },
  })
  return created.id
}

// 首次迁移 LESSONS.md → ChromaDB
async function syncToChroma() {
  try {
    const colId = await getCollection()
    const count = await chromaAPI('GET', `/api/v2/collections/${colId}`)
    if (count.count > 0) return // 已有数据

    const LESSONS_FILE = path.join(MEMORY_DIR, 'LESSONS.md')
    if (!fs.existsSync(LESSONS_FILE)) return

    const content = fs.readFileSync(LESSONS_FILE, 'utf-8')
    const sections = content.split('\n## ')
    const docs = []
    let idx = 0

    for (const section of sections) {
      const lines = section.split('\n')
      const category = lines[0].replace(/^## /, '').trim()
      if (!category || category === '经验教训') continue
      for (const line of lines.slice(1)) {
        if (line.startsWith('- ')) {
          const lesson = line.slice(2).trim()
          if (lesson) {
            docs.push({
              id: `lesson_${idx++}`,
              document: lesson,
              metadata: { category, access_count: 0 },
            })
          }
        }
      }
    }

    if (docs.length > 0) {
      for (let i = 0; i < docs.length; i += 50) {
        const batch = docs.slice(i, i + 50)
        await chromaAPI('POST', `/api/v2/collections/${colId}/add`, {
          ids: batch.map(d => d.id),
          documents: batch.map(d => d.document),
          metadatas: batch.map(d => d.metadata),
        })
      }
      console.log(`ChromaDB 迁移: ${docs.length} 条教训`)
    }
  } catch (e) {
    console.error('ChromaDB sync error:', e.message)
  }
}

// 初始化
async function initChroma() {
  try {
    await startChromaDB()
    await getCollection()
    await syncToChroma()
  } catch (e) {
    console.error('ChromaDB 初始化失败，降级到 SQLite:', e.message)
    _dbReady = false
  }
}
setTimeout(initChroma, 2000)

// 搜索
async function loadLessons(query) {
  if (!_dbReady) {
    // 降级到 SQLite
    const sqlite = require('./memory-db')
    return sqlite.loadLessons(query)
  }

  try {
    const colId = await getCollection()
    if (!query) {
      // 全量返回
      const all = await chromaAPI('GET', `/api/v2/collections/${colId}/get`)
      const grouped = {}
      for (let i = 0; i < all.ids.length; i++) {
        const cat = all.metadatas[i].category
        if (!grouped[cat]) grouped[cat] = []
        grouped[cat].push(`- ${all.documents[i]}`)
      }
      let result = ''
      for (const [cat, lessons] of Object.entries(grouped)) {
        result += `\n## ${cat}\n${lessons.slice(0, 5).join('\n')}\n`
      }
      return result.trim()
    }

    // 混合搜索：语义 + 元数据过滤
    const results = await chromaAPI('POST', `/api/v2/collections/${colId}/query`, {
      query_texts: [query],
      n_results: 5,
    })

    if (!results.ids || !results.ids[0] || results.ids[0].length === 0) return ''

    const grouped = {}
    for (let i = 0; i < results.ids[0].length; i++) {
      const cat = results.metadatas[0][i].category
      if (!grouped[cat]) grouped[cat] = []
      grouped[cat].push(`- ${results.documents[0][i]}`)
    }
    let result = ''
    for (const [cat, lessons] of Object.entries(grouped)) {
      result += `\n## ${cat}\n${lessons.join('\n')}\n`
    }
    return result.trim()
  } catch (e) {
    console.error('ChromaDB search error, fallback:', e.message)
    const sqlite = require('./memory-db')
    return sqlite.loadLessons(query)
  }
}

async function loadMemory() {
  const sqlite = require('./memory-db')
  return sqlite.loadMemory()
}

async function saveMemory(key, value) {
  const sqlite = require('./memory-db')
  return sqlite.saveMemory(key, value)
}

async function searchMemory(query) {
  const sqlite = require('./memory-db')
  return sqlite.searchMemory(query)
}

async function reflect(category, lesson) {
  // 双写：SQLite + ChromaDB
  const sqlite = require('./memory-db')
  const result = await sqlite.reflect(category, lesson)
  
  if (_dbReady && result.success) {
    try {
      const colId = await getCollection()
      const existing = await chromaAPI('POST', `/api/v2/collections/${colId}/query`, {
        query_texts: [lesson],
        n_results: 1,
      })
      const id = `lesson_${Date.now()}`
      await chromaAPI('POST', `/api/v2/collections/${colId}/add`, {
        ids: [id],
        documents: [lesson],
        metadatas: [{ category, access_count: 0 }],
      })
    } catch (_) {}
  }
  return result
}

async function archiveOldLogs() {
  const sqlite = require('./memory-db')
  return sqlite.archiveOldLogs()
}

module.exports = {
  loadMemory, loadLessons, saveMemory, searchMemory, reflect, archiveOldLogs,
  name: 'memory',
  description: 'Phase3: ChromaDB 混合搜索（向量+语义+元数据）+ SQLite 降级',
}
