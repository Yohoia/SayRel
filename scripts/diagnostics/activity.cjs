// Real SQLite aggregation and calendar math; temporary records only.
process.env.TZ = 'America/New_York'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
const { drizzle } = require('drizzle-orm/better-sqlite3')
const root = path.resolve(__dirname, '../..')
function load(file, imports = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText
  const exports = {}
  new Function('require', 'exports', source)(name => imports[name] ?? require(name), exports)
  return exports
}
const { buildActivity, historyActivitySchema, localDateKey } = load('src/shared/activity.ts')
const usageModule = load('src/shared/usage.ts')
const { buildDictationUsage, dictationUsageSchema } = usageModule
const englishUsage = buildDictationUsage([{refinedText:Array(80).fill('word').join(' '),duration:60000}])
assert.deepEqual(englishUsage,{dictationCount:1,durationMs:60000,words:80,wordsPerMinute:80,savedTimeMs:60000})
assert.deepEqual(buildDictationUsage([{refinedText:'中'.repeat(240),duration:60000}]),{dictationCount:1,durationMs:60000,words:240,wordsPerMinute:240,savedTimeMs:60000})
assert.equal(buildDictationUsage([{refinedText:'你好，世界！Hello world. カタカナ 한글',duration:60000}]).words,12,'CJK characters and other words; no punctuation')
const incompleteUsage = buildDictationUsage([{refinedText:'hello world',duration:null},{refinedText:'hello',duration:0},{refinedText:'hello',duration:-1},{refinedText:'hello',duration:Infinity}])
assert.deepEqual(incompleteUsage,{dictationCount:4,durationMs:0,words:5,wordsPerMinute:null,savedTimeMs:0},'missing durations never invent speed or savings')
assert.equal(buildDictationUsage([{refinedText:'hello',duration:120000}]).savedTimeMs,0,'slow dictation does not show negative savings')
assert.deepEqual(buildDictationUsage([]),{dictationCount:0,durationMs:0,words:0,wordsPerMinute:null,savedTimeMs:0})
assert.equal(buildDictationUsage([{refinedText:'hello',duration:1000},{refinedText:'hello world',duration:59000}]).wordsPerMinute,3,'speed uses total duration, not an average of individual speeds')
console.log('PASS CJK and mixed-language counting, weighted speed, estimate basis, missing duration and empty usage')
const now = new Date(2026, 10, 2, 12)
const input = { days: [
  { date:'2025-01-01', count:1 }, { date:'2026-10-30', count:1 },
  { date:'2026-10-31', count:2 }, { date:'2026-10-31', count:4 },
  { date:'2026-11-01', count:10 }, { date:'2026-11-03', count:20 }
] }
const activity = buildActivity(historyActivitySchema.parse(input), now)
assert.equal(activity.activeDays, 4)
assert.equal(activity.currentStreak, 3, 'yesterday keeps an ongoing streak through DST')
assert.equal(activity.longestStreak, 3)
assert.equal(activity.days.length, 182)
assert.equal(activity.days[0].date.getDay(), 0)
assert.equal(activity.days.at(-1).date.getDay(), 6)
assert.equal(activity.days.find(day => day.key === '2026-10-31').count, 6, 'duplicate daily counts merge')
assert.equal(activity.days.find(day => day.key === '2026-10-31').level, 3)
assert.equal(activity.days.find(day => day.key === '2026-11-01').level, 4)
assert.equal(activity.days.filter(day => day.future).length, 5)
assert.equal(new Set(activity.days.map(day => day.key)).size, 182, 'DST has no duplicate or missing dates')
assert.equal(buildActivity(input, new Date(2026,10,5)).currentStreak, 0, 'a missed day breaks the current streak')
assert.equal(buildActivity({days:[]},now).activeDays, 0)
const leap = buildActivity({days:['2024-02-28','2024-02-29','2024-03-01'].map(date=>({date,count:1}))},new Date(2024,2,1,12))
assert.equal(leap.currentStreak, 3)
assert.equal(leap.longestStreak, 3)
assert.equal(localDateKey(new Date('2026-03-08T04:30:00Z')), '2026-03-07')
console.log('PASS local dates, DST, leap day, future cells, streaks, duplicate counts, and empty history')
const schema = load('src/main/db/schema.ts')
const raw = new Database(':memory:')
try {
  for (const file of fs.readdirSync(path.join(root,'src/main/db/sql')).filter(file=>file.endsWith('.sql')).sort()) raw.exec(fs.readFileSync(path.join(root,'src/main/db/sql',file),'utf8'))
  const db = drizzle(raw, {schema})
  const history = load('src/main/services/history.ts', {
    '../../shared/refinement': load('src/shared/refinement.ts'),
    '../db': { getDb:()=>db, getRawDb:()=>raw, schema },
    '../lib/logger': { createLogger:()=>({info(){},warn(){},error(){}}) },
    '../lib/paths': { paths:{} }, '../../shared/constants':load('src/shared/constants.ts'), '../../shared/usage':usageModule
  })
  const insert = raw.prepare('INSERT INTO history_v2 (id,status,created_at) VALUES (?,?,?)')
  for (let index=0;index<600;index++) insert.run('complete-'+index,'completed','2026-03-08T04:30:00Z')
  insert.run('next-day','completed','2026-03-08T07:30:00Z')
  for (const status of ['recording','processing','failed','cancelled']) insert.run(status,status,'2026-03-08T08:00:00Z')
  insert.run('future','completed','2099-01-01T00:00:00Z')
  insert.run('invalid','completed','bad date')
  insert.run('no-date','completed',null)
  const handlers = new Map()
  load('src/main/ipc/history.ts', {
    '../../shared/refinement': load('src/shared/refinement.ts'),
    electron:{}, '../services/recordingMachine':{}, '../services/history':history,
    '../lib/settings':{}, '../lib/paths':{}
  }).registerHistoryHandlers((channel,handler)=>handlers.set(channel,handler))
  const result = historyActivitySchema.parse(handlers.get('db:history-activity')())
  assert.deepEqual(result.days,[{date:'2026-03-07',count:600},{date:'2026-03-08',count:1}])
  assert.equal('refinedText' in result.days[0],false)
  console.log('PASS real IPC handler and SQLite: 600+ records, local midnight, completed only, no text transport')
  const insertUsage = raw.prepare('INSERT INTO history_v2 (id,status,mode,refined_text,duration,created_at) VALUES (?,?,?,?,?,?)')
  insertUsage.run('usage-dictation','completed','voice_transcript','hello world',60000,'2026-03-08T07:30:00Z')
  insertUsage.run('usage-translation','completed','translation','中'.repeat(120),60000,'2026-03-08T07:30:00Z')
  insertUsage.run('usage-answer','completed','ask_anything','excluded answer',100000,'2026-03-08T07:30:00Z')
  insertUsage.run('usage-failed','failed','voice_transcript','excluded failure',100000,'2026-03-08T07:30:00Z')
  const stats = dictationUsageSchema.parse(handlers.get('db:history-usage')())
  assert.deepEqual(stats,{dictationCount:603,durationMs:120000,words:122,wordsPerMinute:61,savedTimeMs:0})
  assert.equal('refinedText' in stats,false,'usage IPC returns only numeric aggregates')
  console.log('PASS real usage IPC and SQLite: all 600+ retained records, translations included, answers and failures excluded')
} finally { raw.close() }
