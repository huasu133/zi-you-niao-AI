# 自由鸟记忆系统 — 数据库与存储审查报告

**审查对象**: `F:/ziyouniao/tools/memory.js`  
**审查人**: db-expert  
**日期**: 2026-06-03

---

## 1. I/O 模式审查

### 当前状态

模块使用 `fs/promises`（异步 API），方向正确。但存在多处 TOCTOU（Time-of-check to Time-of-use）反模式：

| 位置 | 操作 | 问题 |
|------|------|------|
| `loadMemory():25-28` | `stat()` → `readFile()` | 两次 I/O，stat 和 readFile 之间文件可能被修改 |
| `init():13-14` | `access()` → `writeFile()` | access 返回 404 后 writeFile 时可能文件已被创建 |
| `logDaily():35-36` | `access()` → `writeFile()` | 同上 |
| `initLessons():89-91` | `access()` → `writeFile()` | 同上 |
| `searchMemory():74-82` | N 次顺序 `readFile` | N 个每日文件 = N 次 I/O，无并行 |
| `task.js:7-8` | `existsSync()` → `readFileSync()` | 同步 I/O 阻塞事件循环 |

### 建议

```
// 消除 TOCTOU：用 try-catch 替代 access + action
// 当前（反模式）:
try { await fs.access(file) } catch { await fs.writeFile(file, data) }

// 改进:
try { await fs.writeFile(file, data, { flag: 'wx' }) } catch (e) {
  if (e.code !== 'EEXIST') throw e  // 文件已存在是正常的
}

// loadMemory 的 stat+read 二次 I/O:
// 方案 A: 直接用 readFile，如果无变化则缓存
// 方案 B: 用 fs.watchFile 驱动失效
```

**严重度**: 中等。在当前单进程场景下不会出问题，但多进程/多实例场景下会导致数据丢失或重复创建。

**注意 task.js 混用同步 I/O**: `task.js` 使用 `fs.existsSync` + `fs.readFileSync` + `fs.writeFileSync`（同步阻塞），而 `memory.js` 使用异步。同一进程中混合同步/异步 I/O 是合理的（tasks.json 是小文件），但 task.js 也有相同的 TOCTOU 问题（`loadTasks` → `saveTasks` 中间状态）。

---

## 2. 缓存策略审查

### 当前实现

```
let _memCache = null
let _memCacheMtime = 0

async function loadMemory() {
  const stat = await fs.stat(MEMORY_FILE)      // I/O #1
  if (stat.mtimeMs === _memCacheMtime && _memCache !== null) return _memCache
  _memCache = (await fs.readFile(...)).trim()   // I/O #2
  _memCacheMtime = stat.mtimeMs
  return _memCache
}
```

### 问题

1. **被动失效**：缓存只在 `saveMemory()` 中手动清除（`_memCache = null; _memCacheMtime = 0`），无 TTL。如果 MEMORY.md 被外部修改，缓存永远不会感知（除非线程恰好做了 saveMemory）。

2. **粗粒度失效**：`saveMemory` 总是将整个缓存丢弃，即使只是新增/修改一行。对于 MEMORY.md 这种 append-mostly 文件，可以增量更新缓存。

3. **mtime 精度问题**：`mtimeMs` 在某些文件系统（如 FAT32）上精度可能是 2 秒。同一秒内的两次 write 无法被 mtime 区分。

4. **stat 后数据竞争**：`loadMemory:27` — `_memCacheMtime = stat.mtimeMs` 使用的是 stat 时刻的时间戳，但 `readFile` 读取的实际内容可能是 stat 之后被修改的，造成缓存时间戳与实际内容不一致。

### 建议

```
// 最优方案：直接读文件，比较内容决定是否更新缓存
// 因为 mtime 检测本质上是为了避免读文件，但当前已经读了 stat
// 且 mtime 本身是不可靠的一致性信号

let _memCache = null
let _memCacheHash = null  // 快速 hash 比 mtime 可靠

async function loadMemory() {
  const raw = await fs.readFile(MEMORY_FILE, 'utf-8')
  const content = raw.trim()
  // 使用简单 hash 检测变化（比 mtime 更可靠）
  const hash = simpleHash(content)
  if (hash !== _memCacheHash) {
    _memCache = content
    _memCacheHash = hash
  }
  return _memCache
}
```

**严重度**: 低。当前在单进程使用中缓存策略基本可用，mtime 精度问题极为罕见。但如果未来支持多进程或热重载，需要升级。

---

## 3. 并发安全性审查

### 核心问题：read-then-write 竞态

`saveMemory` 存在经典的 read-then-write 竞态条件：

```javascript
async function saveMemory(key, value) {
  // (A) 读取当前文件内容
  const current = await fs.readFile(MEMORY_FILE, 'utf-8')  // ← 时间点 T1
  // ... 修改逻辑 ...
  // (B) 写回文件
  await fs.writeFile(MEMORY_FILE, newContent)               // ← 时间点 T2
}
```

**竞态场景**：
```
进程 A: readFile (T1) → 修改 → writeFile "条目1, 条目A" (T2)
进程 B: readFile (T1.5) → 修改 → writeFile "条目1, 条目B" (T2.1)
结果: 进程 A 的写入 "条目A" 被进程 B 覆盖丢失
```

### 受影响函数

| 函数 | 操作模式 | 风险 |
|------|----------|------|
| `saveMemory()` | read → modify → write (全量重写) | 高 — 并发写入数据丢失 |
| `reflect()` | read → modify → write (全量重写) | 高 — 同上 |
| `logDaily()` | access → writeFile + appendFile | 中 — append 相对安全但 init 步骤有竞态 |

### 建议（按优先级）

**方案 A — 简单方案（推荐用于当前规模）**：
- 对 `saveMemory` 和 `reflect` 加内存互斥锁
- MEMORY.md 改用 append-only 模式（不原地修改，只追加，搜索时取最新的 key）

```javascript
let _writeLock = Promise.resolve()
function withLock(fn) {
  const p = _writeLock.then(() => fn()).finally(() => {})
  _writeLock = p.catch(() => {})
  return p
}
```

**方案 B — 文件锁方案**：
- 使用 `proper-lockfile` 或操作系统级文件锁

**方案 C — 原地替换优化**：
- 如果 key 已存在且行位置已知，使用 `fs.write` 的 position 参数做原地覆盖（需要确保新旧行字节数一致，通常做不到）
- 不可行，放弃

**严重度**: 中高。当前如果是单 Agent 单线程调用，不会触发此问题。但如果工具被并行调用（MCP 协议允许多个 tool call 同时执行），就会出现竞态。

---

## 4. 文件增长管理审查

### 当前行为

`MEMORY.md` 是无界增长的：

- `saveMemory` 对同一 key 做行内替换（原地更新），key 数量受控 ✓
- 但每次替换写回时，`logDaily` 也向当日文件追加了一份 ✓
- **没有大小上限**，没有归档策略，没有压缩
- `searchMemory` 全量扫描所有 `.md` 文件（除了 MEMORY.md 和 LESSONS.md）

### 增长曲线估算

```
MEMORY.md:         ~N 个 key × 80 字节/行 = 可控（几千 key = 几百 KB）
每日日志 (*.md):   每天 ~K 条记录 × 80 字节 = 每天 K×80 字节
LESSONS.md:        ~M 条经验 × 100 字节 = 可控
```

**实际瓶颈在于每日日志**：如果每天产生 100 条 saveMemory 调用，一年后单个文件约 8KB，30 个文件 = 240KB，尚可接受。但如果日志条目来自更多操作（如每次对话都记录），可能会快速增长。

### `searchMemory` 的全量扫描问题

```javascript
// 每次搜索都顺序读取所有每日文件 — O(N) 文件 I/O
for (const file of files) {
  const content = await fs.readFile(path.join(MEMORY_DIR, file), 'utf-8')
  // ...
}
```

当日志文件超过 50 个时，每次搜索延迟 >100ms。

### 建议

1. **短期**：为 `searchMemory` 的结果数量添加限制（已有 `slice(0, 20)` ✓），但限制的是结果数，不是检查的文件数
2. **中期**：添加每日日志的自动归档 — 超过 30 天的日志合并为一个 `archive-YYYY-MM.md`
3. **长期**：引入轻量级全文索引（如 `minisearch` 或 Lua 嵌入式 `lunr.js`），避免全量扫描

### 归档建议

```
// 在合适的地方（如每天首次启动）运行
async function archiveOldLogs(retentionDays = 30) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - retentionDays)
  const files = (await fs.readdir(MEMORY_DIR))
    .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
  for (const file of files) {
    const date = file.replace('.md', '')
    if (new Date(date) < cutoff) {
      const content = await fs.readFile(path.join(MEMORY_DIR, file), 'utf-8')
      // 追加到归档文件
      await fs.appendFile(path.join(MEMORY_DIR, 'archive.md'), `\n## ${date}\n\n${content}`)
      await fs.unlink(path.join(MEMORY_DIR, file))
    }
  }
}
```

**严重度**: 低（短期），中（长期）。当前数据量小不会成为问题，但架构上没有增长控制是技术债。

---

## 5. LESSONS.md 经验库检索效率

### 当前实现

```
loadLessons()  → 返回整个 LESSONS.md 的原始内容（字符串）
reflect()      → 正则匹配查找已有类别 → 行内替换或追加
```

### 问题

1. **无结构化存储**：LESSONS.md 是纯文本，`loadLessons` 返回原始字符串。调用者需要自己解析 `- YYYY-MM-DD [category]: lesson` 格式。

2. **全量返回**：不管调用者只需要某个类别的经验，总是返回全部内容，没有按类别过滤的接口。

3. **无去重/相似度检测**：同一类别的多条经验不会检测语义重复。

4. **正则扫描更新**：`reflect` 使用 `RegExp('- \\d{4}-\\d{2}-\\d{2} \\[${escCategory}\\]: .*', 'm')`，每写入一次都要扫描整个文件。

5. **与 memory.js 的其他部分分离**：LESSONS.md 的搜索不包含在 `searchMemory` 中（第74行显式排除了它），但也没有独立的 `searchLessons` 接口。

### 性能分析

| 指标 | 当前值 | 评价 |
|------|--------|------|
| 读取复杂度 | O(1) 文件读取 | 可接受 |
| 写入复杂度 | O(N) 全文正则扫描 | N 大会变慢 |
| 按类别检索 | 不支持 | 调用者自己解析 |
| 模糊搜索 | 不支持 | — |

### 建议

**方案 A — 轻量级（推荐）**：

```javascript
// 结构化存储：用 JSON 文件替代 markdown
const LESSONS_JSON = path.join(MEMORY_DIR, 'lessons.json')
// 结构: { [category]: [{ date, lesson, id }] }

async function searchLessonsByCategory(category) {
  const data = JSON.parse(await fs.readFile(LESSONS_JSON, 'utf-8'))
  return data[category] || []
}
```

**方案 B — 保持 markdown 但加索引**：
- 启动时解析 LESSONS.md 为内存 Map<category, Lesson[]>
- 写入时同步更新内存 Map 和文件
- 同样保留 markdown 人类可读的优势

**方案 C — SQLite（重型）**：
- 适合数据量 >10000 条时
- 当前不推荐

**严重度**: 低。当前 LESSONS.md 数据量极小（76 字节），性能不是问题。但接口设计缺少按类别检索的能力，限制了上层使用。

---

## 6. 每日日志压缩归档建议

### 当前状态

`logDaily()` 在每次 `saveMemory` 时被调用，向 `YYYY-MM-DD.md` 追加一行。没有：
- 文件数量限制
- 归档策略
- 清理策略
- 压缩

### 建议方案

```
memory/
├── MEMORY.md          # 当前活动记忆
├── LESSONS.md         # 经验库
├── experts/           # 专家配置
├── daily/             # 按月的每日日志
│   ├── 2026-05.md     # 5 月的合并日志
│   └── 2026-06.md     # 当月活跃日志（每日追加）
└── archive/           # 季度归档（压缩）
    └── 2026-Q1.tar.gz
```

**实施步骤**：

1. **每日合并**（每天 00:00 或首次启动）：将前一天的 `YYYY-MM-DD.md` 追加到 `daily/YYYY-MM.md`，删除单日文件
2. **月度归档**（每月 1 日）：将上个月的 `daily/YYYY-MM.md` 压缩为 `archive/YYYY-MM.tar.gz`
3. **搜索优化**：`searchMemory` 只搜索当月 `daily/YYYY-MM.md` + MEMORY.md，如用户明确需要更早的结果，提供 `--archive` 标志

### 实现伪代码

```javascript
async function rotateDailyLog(today) {
  const yesterday = /* 计算昨天的日期字符串 */
  const yesterdayFile = path.join(MEMORY_DIR, yesterday + '.md')
  const monthFile = path.join(MEMORY_DIR, 'daily', yesterday.slice(0, 7) + '.md')
  
  try {
    await fs.access(yesterdayFile)
    await fs.mkdir(path.join(MEMORY_DIR, 'daily'), { recursive: true })
    const content = await fs.readFile(yesterdayFile, 'utf-8')
    await fs.appendFile(monthFile, '\n' + content)
    await fs.unlink(yesterdayFile)
  } catch (_) { /* 昨天的日志不存在，跳过 */ }
}
```

**严重度**: 低（当前），中（3个月后）。日志文件的线性增长最终会影响 `searchMemory` 的性能。

---

## 7. 额外发现

### 7.1 错误吞噬（Error Swallowing）

几乎所有 try-catch 都是 `catch (_) {}` — 错误被静默丢弃：

| 函数 | 吞掉的错误 |
|------|-----------|
| `init()` | mkdir 失败？磁盘满？权限不足？ |
| `loadMemory()` | stat/readFile 失败返回空字符串（静默） |
| `logDaily()` | 写入失败静默丢弃（数据丢失！） |
| `searchMemory()` | readdir/readFile 失败静默继续 |
| `loadLessons()` | 文件读取失败返回空字符串 |

**建议**: 至少用 `console.error` 记录错误，或使用 `process.stderr.write` 避免阻塞。

### 7.2 内存泄漏风险

`_memCache` 是全局变量，永远持有 MEMORY.md 的完整内容。如果 MEMORY.md 增长到几 MB（在大量 key 场景下），这些字符串会常驻内存。建议添加 `invalidateCache()` 函数允许手动释放。

### 7.3 task.js 的同步 I/O

`task.js` 使用 `fs.existsSync` + `fs.readFileSync` + `fs.writeFileSync`。对于小 JSON 文件这是合理的设计选择（避免异步复杂性），但 `loadTasks` → `saveTasks` 之间没有锁保护，存在与 memory.js 相同的 read-then-write 竞态。

---

## 8. 优先级行动清单

| 优先级 | 问题 | 方案 | 影响范围 |
|--------|------|------|----------|
| **P0 立即** | `saveMemory` read-then-write 竞态 | 添加内存互斥锁 | memory.js L41-56 |
| **P0 立即** | `reflect` read-then-write 竞态 | 添加内存互斥锁 | memory.js L104-118 |
| **P1 重要** | `logDaily` TOCTOU + 错误吞噬 | try-catch 写替代 access+写 | memory.js L33-38 |
| **P1 重要** | `loadMemory` 二次 I/O | 合并为单次 readFile + hash 检测 | memory.js L23-31 |
| **P2 建议** | LESSONS.md 结构化 | 转为 JSON 存储 + 类别索引 | memory.js L87-118 |
| **P2 建议** | 每日日志无限增长 | 添加月度合并归档 | 新增函数 |
| **P3 优化** | `searchMemory` 全量扫描 | 限制检查文件数 / 添加简单索引 | memory.js L67-84 |
| **P3 优化** | task.js 同步 I/O | 加写锁 / 转为异步 | task.js |
| **P3 优化** | 错误吞噬 | 统一错误日志 | 全局 |

---

## 总结

`memory.js` 的核心设计思路（key-value 行存储 + 每日日志）对于当前规模是合适的。主要风险集中在两方面：

1. **并发写入的数据丢失**（P0）：缺乏写锁保护，在工具并行调用时会丢失数据
2. **无增长控制**（P2）：虽然没有立即性能问题，但架构上缺少文件生命周期管理

修复 P0 和 P1 项后，该模块可以安全服务于数十个并发会话、数万条记忆的规模。超过此规模时建议迁移到 SQLite。

---

*审查完成，等待 team-lead 反馈。*
