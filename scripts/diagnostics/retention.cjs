// Electron's Node ABI matches the installed SQLite module. Only temporary data is used.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const ts = require('typescript')
const Database = require('better-sqlite3')
const { drizzle } = require('drizzle-orm/better-sqlite3')
const root = path.resolve(__dirname, '../..')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'offkey-retention-'))
const logger = { info() {}, warn() {}, error() {} }
function load(file, imports = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText
  const exports = {}
  new Function('require', 'exports', source)(name => imports[name] ?? require(name), exports)
  return exports
}
const schema = load('src/main/db/schema.ts')
const raw = new Database(':memory:')
raw.exec(fs.readFileSync(path.join(root, 'src/main/db/sql/0000_init.sql'), 'utf8'))
const db = drizzle(raw, { schema })
const history = load('src/main/services/history.ts', {
  '../db': { getDb: () => db, getRawDb: () => raw, schema },
  '../lib/logger': { createLogger: () => logger },
  '../lib/paths': { paths: { recordings: temporary } },
  '../../shared/constants': load('src/shared/constants.ts')
})
let config = { historyRetentionDays: 0, audioRetentionDays: 0 }
const jobs = new Map()
const cleanup = load('src/main/services/cleanup.ts', {
  'node-schedule': { scheduleJob(cron, callback) { jobs.set(cron, callback); return { cancel() {} } } },
  '../lib/settings': { settings: { get: () => config } },
  './history': history,
  '../lib/logger': { createLogger: () => logger }
})
function record(id, days, audio = false) {
  const file = audio ? path.join(temporary, id + '.ogg') : null
  if (file) fs.writeFileSync(file, 'fixture')
  history.upsertHistory({ id, refinedText: id, audioLocalPath: file })
  raw.prepare('UPDATE history_v2 SET created_at = ? WHERE id = ?').run(new Date(Date.now() - days * 86400000).toISOString(), id)
  return file
}
async function main() {
  cleanup.startCleanupSchedule()
  const audio = record('forever', 31, true)
  await jobs.get('*/30 * * * *')()
  assert.equal(history.getHistory('forever')?.refinedText, 'forever')
  assert.ok(fs.existsSync(audio))
  console.log('PASS periodic disk check preserves unlimited history and audio')

  const fresh = record('fresh-audio', 1, true)
  record('old-text-only', 31)
  config = { historyRetentionDays: 0, audioRetentionDays: 30 }
  await jobs.get('0 3 * * *')()
  assert.equal(history.getHistory('forever')?.refinedText, 'forever')
  assert.equal(history.getHistory('forever')?.audioLocalPath, null)
  assert.equal(fs.existsSync(audio), false)
  assert.ok(fs.existsSync(fresh))
  assert.ok(history.getHistory('old-text-only'))
  console.log('PASS audio retention deletes expired audio while preserving text and recent audio')

  const handlers = new Map()
  load('src/main/ipc/history.ts', {
    electron: {}, '../services/recordingMachine': {}, '../services/history': history,
    '../lib/settings': { settings: { get: () => config } }, '../lib/paths': { paths: {} }
  }).registerHistoryHandlers((name, handler) => handlers.set(name, handler))
  const manual = record('manual-audio', 31, true)
  await handlers.get('db:history-trigger-disk-cleanup')()
  assert.ok(history.getHistory('manual-audio'))
  assert.equal(history.getHistory('manual-audio').audioLocalPath, null)
  assert.equal(fs.existsSync(manual), false)
  console.log('PASS manual audio cleanup preserves the history row')

  config = { historyRetentionDays: 7, audioRetentionDays: 0 }
  await jobs.get('0 3 * * *')()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(history.getHistory('forever'), null)
  assert.equal(history.getHistory('old-text-only'), null)
  assert.ok(history.getHistory('fresh-audio'))
  console.log('PASS finite history retention still removes only expired rows')
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  cleanup.stopCleanupSchedule()
  raw.close()
  fs.rmSync(temporary, { recursive: true, force: true })
})
