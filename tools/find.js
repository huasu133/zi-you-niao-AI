const { exec } = require('child_process')
const { promisify } = require('util')
const path = require('path')
const execAsync = promisify(exec)

async function findFiles({ pattern, directory }) {
  const homedir = process.env.HOME || process.env.USERPROFILE
  const dir = directory ? path.resolve(homedir, directory.replace(/^~/, '')) : homedir
  const isWithin = dir === homedir || !path.relative(homedir, dir).startsWith('..')
  if (!isWithin) return { error: '目录不在允许范围内' }
  // 拒绝含危险字符的 pattern（安全审查建议）
  if (/[;&|`$(){}]/.test(pattern)) return { error: '文件名模式包含非法字符' }
  const sanitized = pattern.replace(/[;&|`$()]/g, '')
  const isWin = process.platform === 'win32'
  const cmd = isWin
    ? `dir /s /b "${dir}\\${sanitized}" 2>nul`
    : `find "${dir}" -name "${sanitized}" -type f 2>/dev/null | head -30`
  try {
    const { stdout } = await execAsync(cmd, { timeout: 10000 })
    const files = stdout.trim().split('\n').filter(Boolean).slice(0, 30)
    return { files }
  } catch (e) {
    return { error: `搜索失败: ${e.message}` }
  }
}

module.exports = { findFiles, name: 'find_files', description: '搜索文件系统中的文件' }
