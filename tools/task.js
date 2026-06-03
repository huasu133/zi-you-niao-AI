const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const TASK_FILE = path.join(__dirname, '..', 'tasks.json')

function loadTasks() {
  if (!fs.existsSync(TASK_FILE)) return []
  try { return JSON.parse(fs.readFileSync(TASK_FILE, 'utf-8')) } catch { return [] }
}

function saveTasks(tasks) {
  fs.writeFileSync(TASK_FILE, JSON.stringify(tasks, null, 2))
}

function createTask(subject, description) {
  const tasks = loadTasks()
  const task = {
    id: crypto.randomUUID(),
    subject,
    description: description || '',
    status: 'pending',
    createdAt: new Date().toISOString().slice(0, 10),
  }
  tasks.push(task)
  saveTasks(tasks)
  return task
}

function listTasks(filter) {
  let tasks = loadTasks()
  if (filter === 'done') tasks = tasks.filter(t => t.status === 'completed')
  if (filter === 'pending') tasks = tasks.filter(t => t.status === 'pending')
  return tasks
}

function updateTask(id, updates) {
  const tasks = loadTasks()
  const idx = tasks.findIndex(t => t.id === id)
  if (idx === -1) return { error: '任务不存在' }
  tasks[idx] = { ...tasks[idx], ...updates }
  saveTasks(tasks)
  return tasks[idx]
}

module.exports = { createTask, listTasks, updateTask, name: 'task', description: '任务管理：创建、列表、更新状态' }
