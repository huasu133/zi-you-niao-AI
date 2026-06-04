require('dotenv').config()
const path = require('path')
const fs = require('fs')
const OpenAI = require('openai')
const { TOOLS, SAFETY_RULES } = require('./tool-registry')
const { loadMemory, loadLessons } = require('./tools/memory')

let _openai = null
function getOpenAI() {
  if (!_openai) {
    _openai = new OpenAI({
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: process.env.DEEPSEEK_API_KEY,
    })
  }
  return _openai
}

function sanitizeOutput(text) {
  return text
    .replace(/sk_live_[a-zA-Z0-9]+/g, 'sk_live_***')
    .replace(/sk_test_[a-zA-Z0-9]+/g, 'sk_test_***')
    .replace(/ghp_[a-zA-Z0-9]{36}/g, 'ghp_***')
    .replace(/github_pat_[a-zA-Z0-9_]{82}/g, 'github_pat_***')
    .replace(/AKIA[A-Z0-9]{16}/g, 'AKIA***')
    .replace(/-----BEGIN[^-]+PRIVATE KEY-----[\s\S]*?-----END[^-]+PRIVATE KEY-----/g, '***PRIVATE KEY***')
    .replace(/sk-[a-zA-Z0-9]{20,}/g, 'sk-***')
}

async function getMemoryDesc() {
  const current = await loadMemory()
  const lessons = await loadLessons()
  const lessonsPart = lessons ? `\n\n## 过往经验教训（参考避免踩坑）\n${lessons}` : ''
  const memPart = current !== '# 关于用户\n\n'
    ? `\n\n## 关于用户的记忆（持续积累）\n${current}`
    : '\n\n## 关于用户的记忆\n暂无。'
  return memPart + lessonsPart
}

async function callExpert(expert, userMessage, history) {
  const historyDir = path.join(__dirname, 'memory', 'experts')
  if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true })

  const historyFile = path.join(historyDir, `${expert.role}.json`)
  let expertHistory = []
  if (fs.existsSync(historyFile)) {
    try { expertHistory = JSON.parse(fs.readFileSync(historyFile, 'utf-8')) } catch (e) {
      console.warn(`专家 ${expert.role} 历史文件损坏，已重置`)
    }
  }
  const expertToolDefs = TOOLS.filter(t => expert.tools.includes(t.function.name))

  // 确认保护：危险操作必须真人确认，不能由LLM绕过
  async function safeHandler(tool, args, expert) {
    const dangerousOps = ['write_file', 'run_command']
    if (dangerousOps.includes(tool.function.name)) {
      // LLM可能注入 __confirmed，强制删除
      delete args.__confirmed
      const chatId = expertHistory.length > 0 ? `chat_${expertHistory.length}` : 'chat_1'
      return JSON.stringify({
        error: `⛔ 专家 ${expert.role} 想执行 ${tool.function.name}，需要你在对话中输入"确认"来批准`,
        confirm_required: true,
        confirm_id: Buffer.from(`${chatId}:${tool.function.name}:${Date.now()}`).toString('base64')
      })
    }
    return await tool.handler(args)
  }
  const messages = [
    { role: 'system', content: `${expert.soul}\n\n## 用户信息\n${await getMemoryDesc()}\n\n${SAFETY_RULES}\n你只能使用以下工具：${expert.tools.join(', ')}` },
    ...expertHistory.slice(-10),
    { role: 'user', content: userMessage },
  ]

  const completion = await getOpenAI().chat.completions.create({
    model: 'deepseek-chat',
    messages,
    tools: expertToolDefs.map(t => ({ type: t.type, function: t.function })),
    tool_choice: 'auto',
  })

  const reply = completion.choices[0].message
  let finalContent = reply.content || ''

  if (reply.tool_calls) {
    messages.push(reply)
    for (const tc of reply.tool_calls) {
      const tool = expertToolDefs.find(t => t.function.name === tc.function.name)
      if (tool) {
        try {
          const args = JSON.parse(tc.function.arguments)
          const result = await safeHandler(tool, args, expert)
          messages.push({ role: 'tool', content: typeof result === 'string' ? result : JSON.stringify(result), tool_call_id: tc.id })
        } catch (e) {
          messages.push({ role: 'tool', content: `执行错误: ${e.message}`, tool_call_id: tc.id })
        }
      }
    }
    for (let round = 0; round < 3; round++) {
      const next = await getOpenAI().chat.completions.create({
        model: 'deepseek-chat', messages, tools: expertToolDefs.map(t => ({ type: t.type, function: t.function })), stream: false,
      })
      const msg = next.choices[0].message
      if (!msg.tool_calls) { finalContent = msg.content || ''; break }
      messages.push(msg)
      for (const tc of msg.tool_calls) {
        const tool = expertToolDefs.find(t => t.function.name === tc.function.name)
        if (tool) {
          try {
            const args = JSON.parse(tc.function.arguments)
            const result = await safeHandler(tool, args, expert)
            messages.push({ role: 'tool', content: typeof result === 'string' ? result : JSON.stringify(result), tool_call_id: tc.id })
          } catch (e) {
            messages.push({ role: 'tool', content: `执行错误: ${e.message}`, tool_call_id: tc.id })
          }
        }
      }
    }
  }

  if (!finalContent) finalContent = '专家分析完成，但未生成文字总结。'

  expertHistory.push(
    { role: 'user', content: userMessage },
    { role: 'assistant', content: finalContent }
  )

  // 原子写入：先写 .tmp 再 rename
  const tmpFile = historyFile + '.tmp'
  fs.writeFileSync(tmpFile, JSON.stringify(expertHistory.slice(-30)))
  fs.renameSync(tmpFile, historyFile)

  return sanitizeOutput(finalContent)
}

module.exports = { callExpert }
