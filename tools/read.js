const fs = require('fs/promises')
const path = require('path')

function isWithinHomedir(homedir, resolvedPath) {
  const relative = path.relative(homedir, resolvedPath)
  return !relative.startsWith('..') && !path.isAbsolute(relative)
}

async function safeResolve(filepath) {
  const homedir = process.env.HOME || process.env.USERPROFILE
  if (!homedir) throw new Error('HOME 未设置')
  const resolved = path.resolve(homedir, filepath.replace(/^~/, ''))
  if (!isWithinHomedir(homedir, resolved)) return null
  try {
    const real = await fs.realpath(resolved)
    if (!isWithinHomedir(homedir, real)) return null
    return real
  } catch {
    return null
  }
}

const SENSITIVE_PATTERNS = [
  /[\\/]\.ssh[\\/]/, /[\\/]\.aws[\\/]/, /[\\/]\.gnupg[\\/]/,
  /[\\/]\.env$/, /[\\/]\.config[\\/]/,
  /[\\/]AppData[\\/]Local[\\/]/, /[\\/]Application Data[\\/]/,
  /[\\/]etc[\\/]passwd$/, /[\\/]etc[\\/]shadow$/,
  /[\\/]etc[\\/]sudoers/, /[\\/]proc[\\/]self[\\/]environ/,
]

const MAX_FILE_SIZE = 10 * 1024 * 1024

async function readFile(filepath) {
  try {
    const resolved = await safeResolve(filepath)
    if (!resolved) return { error: '路径不在允许范围内或文件不存在' }
    for (const p of SENSITIVE_PATTERNS)
      if (p.test(resolved)) return { error: '不允许读取敏感文件' }
    const stat = await fs.stat(resolved)
    if (!stat.isFile()) return { error: '不是文件' }
    if (stat.size > MAX_FILE_SIZE) return { error: '文件过大 (超过10MB)' }
    const content = await fs.readFile(resolved, 'utf-8')
    return { content }
  } catch (e) {
    return { error: `读取失败: ${e.message}` }
  }
}

module.exports = { readFile, name: 'read_file', description: '读取本地文件内容' }
