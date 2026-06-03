const fs = require('fs')
const path = require('path')

const connectors = {}
try {
  const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.js') && f !== 'index.js')
  for (const f of files) {
    const mod = require(`./${f}`)
    connectors[mod.name] = mod
  }
} catch (e) {
  console.error('连接器加载失败:', e.message)
}

module.exports = connectors
