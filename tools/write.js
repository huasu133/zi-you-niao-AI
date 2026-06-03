const fs = require('fs/promises')
const path = require('path')

async function writeFile({ filepath, content }) {
  try {
    const homedir = process.env.HOME || process.env.USERPROFILE
    if (!homedir) return { error: 'HOME 未设置' }
    const resolved = path.resolve(homedir, filepath.replace(/^~/, ''))
    const isWithin = resolved === homedir || !path.relative(homedir, resolved).startsWith('..')
    if (!isWithin) return { error: '路径不允许' }
    try {
      const realDir = await fs.realpath(path.dirname(resolved))
      const dirWithin = realDir === homedir || !path.relative(homedir, realDir).startsWith('..')
      if (!dirWithin) return { error: '路径指向外部' }
    } catch { /* 新目录，realpath 失败是正常的 */ }
    const SENSITIVE = ['.ssh', '.aws', '.gnupg', '.env', '.config', '.git', '.npm', '.docker']
    const segments = resolved.split(path.sep)
    for (const s of SENSITIVE)
      if (segments.includes(s)) return { error: '不允许修改系统文件' }
    await fs.writeFile(resolved, content, 'utf-8')
    return { success: true, path: resolved }
  } catch (e) {
    return { error: `写入失败: ${e.message}` }
  }
}

module.exports = { writeFile, name: 'write_file', description: '写入文件到本地磁盘' }
