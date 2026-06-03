// Phase 3: ChromaDB 主引擎（SQLite 降级）
const chroma = require('./memory-chromadb')
const path = require('path')

const MEMORY_DIR = path.join(__dirname, '..', 'memory')

function getTodayLog() {
  return path.join(MEMORY_DIR, new Date().toISOString().slice(0, 10) + '.md')
}

async function loadMemory() { return chroma.loadMemory() }
async function loadLessons(query) { return chroma.loadLessons(query) }
async function saveMemory(key, value) { return chroma.saveMemory(key, value) }
async function searchMemory(query) { return chroma.searchMemory(query) }
async function reflect(category, lesson) { return chroma.reflect(category, lesson) }
async function archiveOldLogs() { return chroma.archiveOldLogs() }

module.exports = {
  loadMemory, loadLessons, saveMemory, getTodayLog, searchMemory, reflect, archiveOldLogs,
  name: 'memory',
  description: 'Phase3: ChromaDB 混合搜索 + SQLite 降级',
}
