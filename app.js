require('dotenv').config()
const path = require('path')
const express = require('express')
const fs = require('fs')
const OpenAI = require('openai')

// Node.js 版本检查
const NODE_MAJOR = parseInt(process.version.slice(1).split('.')[0])
if (NODE_MAJOR < 18) {
  console.error(`Node.js >= 18 必需，当前版本: ${process.version}`)
  process.exit(1)
}

const connectors = require('./connectors')
const { loadMemory, saveMemory, searchMemory, reflect, loadLessons } = require('./tools/memory')
const { createTask, listTasks, updateTask } = require('./tools/task')
const { EXPERTS, TEAM_DESC, TOOLS, SAFETY_RULES, setSearchMode, getSearchMode } = require('./tool-registry')
const { callExpert } = require('./expert-router')

const app = express()
const openai = new OpenAI({
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY,
  timeout: 120000,
})
const PORT = process.env.PORT || 3456

// 全局异常处理
process.on('uncaughtException', err => {
  console.error('未捕获异常，进程退出:', err)
  process.exitCode = 1
  setTimeout(() => process.exit(1), 1000)
})
process.on('unhandledRejection', (reason, promise) => {
  console.error('未捕获 Promise 拒绝:', reason)
  process.exitCode = 1
  setTimeout(() => process.exit(1), 1000)
})

// 中间件
app.use(express.json({ limit: '1mb' }))
app.use(express.static('public'))

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`)
  next()
})

// 安全头 + 速率限制
const rateLimitMap = new Map()
const RATE_LIMIT_CONFIG = {
  '/health':     { max: 60, window: 60000 },
  '/chat':       { max: 30, window: 60000 },
  '/tasks':      { max: 15, window: 60000 },
  '/api/config': { max: 10, window: 60000 },
  '__default__': { max: 30, window: 60000 },
}
setInterval(() => {
  const now = Date.now()
  for (const [key, timestamps] of rateLimitMap) {
    const filtered = timestamps.filter(t => now - t < 60000)
    if (filtered.length === 0) rateLimitMap.delete(key)
    else rateLimitMap.set(key, filtered)
  }
  if (rateLimitMap.size > 5000) {
    const toDelete = rateLimitMap.size - 5000
    const keys = [...rateLimitMap.keys()].slice(0, toDelete)
    keys.forEach(k => rateLimitMap.delete(k))
  }
}, 60000)

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'")
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
  const conf = RATE_LIMIT_CONFIG[req.path] || RATE_LIMIT_CONFIG.__default__
  const key = `${req.ip}:${req.path}`
  const now = Date.now()
  const timestamps = (rateLimitMap.get(key) || []).filter(t => now - t < conf.window)
  if (timestamps.length >= conf.max) return res.status(429).json({ error: '请求过于频繁' })
  timestamps.push(now)
  rateLimitMap.set(key, timestamps)
  next()
})

// API Token 认证（0.0.0.0 绑定必须）
const API_TOKEN = process.env.API_TOKEN || 'ziyouniao-local'
app.use((req, res, next) => {
  if (req.path === '/health') return next()
  const token = req.headers['x-api-token']
  if (token !== API_TOKEN) return res.status(401).json({ error: '未授权' })
  next()
})

// 端点
app.get('/health', (req, res) => res.json({ status: 'ok' }))
app.get('/memory', async (req, res) => res.json({ content: await loadMemory() }))
app.get('/memory/search', async (req, res) => res.json({ results: await searchMemory(req.query.q || '') }))
app.get('/experts', (req, res) => res.json({ experts: EXPERTS.map(e => e.role) }))
app.get('/tools', (req, res) => {
  const list = TOOLS.map(t => ({ name: t.function.name, description: t.function.description }))
  res.json({ tools: list })
})
app.get('/tasks', (req, res) => res.json({ tasks: listTasks(req.query.filter) }))
app.post('/tasks', (req, res) => {
  const { subject, description } = req.body
  if (!subject) return res.status(400).json({ error: '缺少任务标题' })
  res.json(createTask(subject, description))
})
app.patch('/tasks/:id', (req, res) => {
  res.json(updateTask(req.params.id, req.body))
})
app.get('/connectors', (req, res) => {
  const status = {}
  for (const [name, mod] of Object.entries(connectors)) {
    status[name] = mod.name === 'github' ? !!process.env.GITHUB_TOKEN : false
  }
  res.json({ connectors: status })
})
app.get('/api/config', (req, res) => res.json({ searchMode: getSearchMode() }))
app.post('/api/config', (req, res) => {
  if (['basic', 'deep'].includes(req.body.searchMode)) {
    setSearchMode(req.body.searchMode)
    res.json({ searchMode: getSearchMode() })
  } else {
    res.status(400).json({ error: '无效的搜索模式，可选 basic/deep' })
  }
})

// 加载总控身份
const BASE_PROMPT = fs.readFileSync(path.join(__dirname, 'soul.md'), 'utf-8')

// 记忆描述
async function getMemoryDesc(userMessage) {
  const current = await loadMemory()
  const lessons = await loadLessons(userMessage) // 传用户消息做关键词匹配
  const lessonsPart = lessons ? `\n\n## 过往经验教训（参考避免踩坑）\n${lessons}` : ''
  const memPart = current !== '# 关于用户\n\n'
    ? `\n\n## 关于用户的记忆（持续积累）\n${current}\n\n发现新的重要信息时用 save_memory 记录下来。`
    : '\n\n## 关于用户的记忆\n暂无。在对话中发现关于用户的重要信息时（技能、偏好、习惯），用 save_memory 记录下来。'
  return memPart + lessonsPart + '\n\n每次完成任务或遇到错误后，用 reflect_lesson 记录经验教训，避免下次犯同样错误。'
}

// 输出脱敏
function sanitizeText(text) {
  const patterns = [
    { regex: /sk_live_[a-zA-Z0-9]+/g, replacement: 'sk_live_***' },
    { regex: /sk_test_[a-zA-Z0-9]+/g, replacement: 'sk_test_***' },
    { regex: /ghp_[a-zA-Z0-9]{36}/g, replacement: 'ghp_***' },
    { regex: /github_pat_[a-zA-Z0-9_]{82}/g, replacement: 'github_pat_***' },
    { regex: /AKIA[A-Z0-9]{16}/g, replacement: 'AKIA***' },
    { regex: /-----BEGIN[^-]+PRIVATE KEY-----[\s\S]*?-----END[^-]+PRIVATE KEY-----/g, replacement: '***PRIVATE KEY***' },
    { regex: /sk-[a-zA-Z0-9]{20,}/g, replacement: 'sk-***' },
    { regex: /["']?(DEEPSEEK|OPENAI|TAVILY|CONTEXTWIRE|SERPER)_API_KEY["']?\s*[:=]\s*["']?[^"'\s]+["']?/gi, replacement: '$1_API_KEY=***' },
  ]
  let result = text
  for (const { regex, replacement } of patterns) {
    result = result.replace(regex, replacement)
  }
  return result
}

// 主聊天端点
app.post('/chat', async (req, res) => {
  try {
    const { message, history = [] } = req.body
    if (typeof message !== 'string' || message.length > 10000)
      return res.status(400).json({ error: '无效的输入' })

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    req.setTimeout(180000)

    const requestedExpert = EXPERTS.find(e => e.pattern.test(message))
    if (requestedExpert) {
      const expertReply = await callExpert(requestedExpert, message, history)
      res.write(`\n[已激活专家: ${requestedExpert.role}]\n`)
      res.write(sanitizeText(expertReply))
      res.end()
      return
    }

    const systemPrompt = `${BASE_PROMPT}${TEAM_DESC}${await getMemoryDesc(message)}\n${SAFETY_RULES}`
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-20),
      { role: 'user', content: message },
    ]

    const startTime = Date.now()
    const MAX_TOTAL_TIME = 180000
    let toolCallRounds = 0
    const MAX_TOOL_ROUNDS = 5
    let toolsForThisRound = TOOLS.map(t => ({ type: t.type, function: t.function }))

    while (toolCallRounds < MAX_TOOL_ROUNDS) {
      if (Date.now() - startTime > MAX_TOTAL_TIME) {
        res.write('\n[操作超时，已终止]')
        res.end()
        return
      }
      toolCallRounds++

      const noToolsNext = toolCallRounds >= MAX_TOOL_ROUNDS
      if (noToolsNext) { toolsForThisRound = undefined }

      const completion = await openai.chat.completions.create({
        model: 'deepseek-chat',
        messages,
        tools: toolsForThisRound,
        tool_choice: toolsForThisRound ? 'auto' : undefined,
        stream: true,
      })

      let toolCalls = []
      let content = ''

      for await (const chunk of completion) {
        const delta = chunk.choices[0]?.delta
        if (delta?.content) {
          content += delta.content
          res.write(sanitizeText(delta.content))
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index
            if (!toolCalls[idx]) toolCalls[idx] = { id: '', function: { name: '', arguments: '' } }
            if (tc.id) toolCalls[idx].id += tc.id
            if (tc.function?.name) toolCalls[idx].function.name += tc.function.name
            if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments
          }
        }
      }

      if (toolCalls.length === 0) {
        res.end()
        return
      }

      messages.push({
        role: 'assistant',
        content: content || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      })

      for (const toolCall of toolCalls) {
        const tool = TOOLS.find(t => t.function.name === toolCall.function.name)
        if (!tool) continue
        let args
        try { args = JSON.parse(toolCall.function.arguments) } catch { continue }
        try {
          const result = await tool.handler(args)
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: typeof result === 'string' ? result : JSON.stringify(result),
          })
        } catch (e) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `执行错误: ${e.message}`,
          })
        }
      }

      // 截断 messages 防止无限增长
      if (messages.length > 50) {
        const systemMsg = messages[0]
        messages.splice(1, messages.length - 50)
        messages.unshift(systemMsg)
      }
    }

    res.end()
  } catch (err) {
    console.error('/chat 错误:', err.message)
    const genericMsg = '内部错误，请重试或简化请求'
    if (!res.headersSent) {
      return res.status(500).json({ error: genericMsg })
    }
    res.write('\n\n' + genericMsg)
    res.end()
  }
})

// 启动
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`自由鸟 v4 运行在 http://127.0.0.1:${PORT}`)
  console.log(`已加载 ${EXPERTS.length} 个专家`)
  console.log(`已注册 ${TOOLS.length} 个工具`)
  const connNames = Object.keys(connectors)
  if (connNames.length) console.log(`已加载连接器: ${connNames.join(', ')}`)
  // Electron 就绪信号
  if (process.send) process.send('ready')
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用，设置 PORT 环境变量换一个端口`)
  }
  process.exit(1)
})

// 优雅关闭
let shuttingDown = false
async function gracefulShutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`\n收到 ${signal}，正在关闭...`)
  server.close(() => {
    console.log('服务器已关闭')
    process.exit(0)
  })
  setTimeout(() => {
    console.error('强制退出')
    process.exit(1)
  }, 5000)
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
