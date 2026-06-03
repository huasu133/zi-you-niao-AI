const fs = require('fs/promises')
const path = require('path')

async function listDir(directory) {
  try {
    const homedir = process.env.HOME || process.env.USERPROFILE
    if (!homedir) return { error: 'HOME 未设置' }
    const dir = path.resolve(homedir, (directory || '').replace(/^~/, ''))
    const isWithin = dir === homedir || !path.relative(homedir, dir).startsWith('..')
    if (!isWithin) return { error: '目录不允许' }
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const items = []
    // 敏感目录过滤（安全审查建议）
    const SENSITIVE_DIRS = new Set(['.ssh', '.aws', '.gnupg', '.git', '.npm', '.docker'])
    for (const e of entries) {
      if (e.isDirectory() && SENSITIVE_DIRS.has(e.name)) continue
      const fullPath = path.join(dir, e.name)
      const stat = e.isFile() ? await fs.stat(fullPath) : null
      items.push({
        name: e.name,
        type: e.isDirectory() ? '目录' : '文件',
        size: stat?.size || null,
        modified: stat?.mtime.toISOString().slice(0, 10) || null,
      })
    }
    items.sort((a, b) => (b.type === '目录' ? 1 : 0) - (a.type === '目录' ? 1 : 0))
    return { directory: dir, items }
  } catch (e) {
    return { error: `读取目录失败: ${e.message}` }
  }
}

module.exports = { listDir, name: 'list_directory', description: '列出目录下的文件和子目录' }
