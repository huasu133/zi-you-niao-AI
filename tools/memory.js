// Phase 2: 桥接到 memory-db.js（SQLite + embedding）
// 保持旧接口兼容，底层切换到 SQLite
const db = require('./memory-db')
const path = require('path')
const fs = require('fs/promises')

const MEMORY_DIR = path.join(__dirname, '..', 'memory')

// 获取今天的日志文件路径（供 tool-registry 使用）
function getTodayLog() {
  return path.join(MEMORY_DIR, new Date().toISOString().slice(0, 10) + '.md')
}

// 全部委托给 SQLite 层
async function loadMemory() { return db.loadMemory() }
async function loadLessons(query) { return db.loadLessons(query) }
async function saveMemory(key, value) { return db.saveMemory(key, value) }
async function searchMemory(query) { return db.searchMemory(query) }
async function reflect(category, lesson) { return db.reflect(category, lesson) }
async function archiveOldLogs() { return db.archiveOldLogs() }

module.exports = {
  loadMemory, loadLessons, saveMemory, getTodayLog, searchMemory, reflect, archiveOldLogs,
  name: 'memory',
  description: '用户记忆系统 Phase2：SQLite + embedding 语义检索',
}
