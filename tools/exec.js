const { exec } = require('child_process')
const { promisify } = require('util')
const execAsync = promisify(exec)

const ALLOWED_PREFIXES = [
  'ls', 'cat', 'grep', 'find', 'git', 'npm', 'node', 'echo', 'pwd',
  'whoami', 'date', 'tail', 'head', 'wc', 'sort', 'uniq', 'ps', 'top',
  'df', 'du', 'which', 'curl', 'wget', 'ping', 'dig', 'nslookup', 'tree',
  'diff', 'file', 'stat', 'test', 'true', 'false',
  'mkdir', 'touch', 'cp', 'mv',
]

async function runCommand(command) {
  if (command.length > 500) return { error: '命令过长 (最大500字符)' }

  const ALLOWED = ALLOWED_PREFIXES.some(p => command === p || command.startsWith(p + ' '))
  const SHELL_BLOCKED = /[|;&`$(){}]/.test(command.replace(/\/\/.*$/,''))
  const BLOCKED = /\b(rm\s+(?:-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+\/+|\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+\/+)|sudo\s+|pkexec\s+|shutdown\s+|reboot\s+|mkfs\s+|:\(\)\s*\{|dd\s+if=)/i
  const NODE_EVAL = /node\s+(-e|--eval)\s+["']/.test(command)

  if (!ALLOWED || SHELL_BLOCKED || BLOCKED.test(command) || NODE_EVAL)
    return { error: '命令未被允许或包含危险操作符' }

  try {
    const { stdout, stderr } = await execAsync(command, { timeout: 30000 })
    return { stdout: stdout.slice(0, 10000), stderr: stderr?.slice(0, 1000) }
  } catch (e) {
    return { error: e.message, stdout: e.stdout?.slice(0, 5000) }
  }
}

module.exports = { runCommand, name: 'run_command', description: '执行系统命令' }
