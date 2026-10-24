const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { randomUUID } = require('node:crypto')
const root = path.resolve(__dirname, '../../..'), cache = new Map(), launches = [], rows = new Map()
let enabled = true, now = 10000, holdLaunch = false
class ClockDate extends Date { static now() { return now } }
const mocks = {
  '../lib/settings': { settings: { get: () => ({ desktopCommandsEnabled: enabled, historyEnabled: true }) } },
  '../lib/logger': { createLogger: () => ({ info() {} }) },
  './history': { getHistory: id => rows.get(id), upsertHistory: row => rows.set(row.id, { ...rows.get(row.id), ...row }) },
  'node:child_process': { execFile(file, args, options, callback) {
    launches.push({ file, args, options })
    if (holdLaunch) options.signal.addEventListener('abort', () => callback(new Error('cancelled')), { once: true })
    else callback(null, { stdout: '', stderr: '' })
  } }
}
function load(file) {
  const absolute = path.resolve(root, file.endsWith('.ts') ? file : file + '.ts')
  if (cache.has(absolute)) return cache.get(absolute)
  const exports = {}; cache.set(absolute, exports)
  const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  vm.runInNewContext(code, { exports, require: id => mocks[id] ?? (id.startsWith('.') ? load(path.resolve(path.dirname(absolute), id)) : require(id)), Date: ClockDate, AbortController, process: { platform: 'darwin' } }, { filename: absolute })
  return exports
}
const { parseDesktopIntent } = load('src/shared/desktopCommands.ts')
const commands = load('src/main/services/desktopCommands.ts')
const final = (asrText, extra = {}) => ({ kind: 'final', sessionId: randomUUID(), requestId: randomUUID(), providerId: 'fixture', model: 'fixture', path: 'live', startedAt: now, completedAt: now, asrText, detectedLanguage: 'en', ...extra })
const context = { focusedApp: { appName: 'Fixture App' }, focusedInput: { isSecure: false, selectedText: 'Selected text at recording start' } }
let checks = 0
async function test(name, run) { commands.cancelDesktopPlan(); enabled = true; holdLaunch = false; launches.length = 0; await run(); checks++; console.log('PASS ' + name) }
;(async () => {
  await test('only explicit single supported actions are accepted in English and Chinese', async () => {
    for (const text of ['Open Safari.', '打开 Safari。', '请打开备忘录', 'Switch to Finder']) assert.equal(parseDesktopIntent(text).kind, 'open_app')
    for (const text of ['Read selected text', '读取选中的文字']) assert.equal(parseDesktopIntent(text).kind, 'read_selection')
    for (const text of ['What is the current app?', '当前是什么应用']) assert.equal(parseDesktopIntent(text).kind, 'read_focused_app')
    for (const text of ['Do not open Safari', 'Open Safari and send a message', '打开Safari然后发邮件', 'Delete my files', '打开终端', 'Open /tmp/file', 'Say Open Safari']) assert.equal(parseDesktopIntent(text), null)
  })
  await test('incomplete, failed, saved and disabled commands cannot produce executable plans', async () => {
    for (const value of [final('Open Safari', { kind: 'partial' }), final('Open Safari', { kind: 'empty', asrText: '' }), final('Open Safari', { path: 'saved' })]) assert.throws(() => commands.prepareDesktopPlan(value, context, null))
    enabled = false; assert.throws(() => commands.prepareDesktopPlan(final('Open Safari'), context, null))
    assert.equal(launches.length, 0)
  })
  await test('preparation has no effects; confirmation uses only an allowlisted bundle ID once', async () => {
    const prepared = commands.prepareDesktopPlan(final('Open Safari'), context, null)
    assert.equal(launches.length, 0)
    assert.match(await commands.approveDesktopPlan(prepared.plan.id), /Opened Safari/)
    assert.equal(launches.length, 1); assert.equal(launches[0].file, '/usr/bin/open'); assert.equal(launches[0].args.join(' '), '-b com.apple.Safari')
    await assert.rejects(commands.approveDesktopPlan(prepared.plan.id), /expired|cancelled/)
  })
  await test('a new plan, explicit cancellation and expiration invalidate old confirmations', async () => {
    const old = commands.prepareDesktopPlan(final('Open Safari'), context, null)
    const next = commands.prepareDesktopPlan(final('Open Notes'), context, null)
    await assert.rejects(commands.approveDesktopPlan(old.plan.id))
    commands.cancelDesktopPlan(); await assert.rejects(commands.approveDesktopPlan(next.plan.id))
    const stale = commands.prepareDesktopPlan(final('Open Finder'), context, null)
    now += 120001; await assert.rejects(commands.approveDesktopPlan(stale.plan.id)); assert.equal(launches.length, 0)
  })
  await test('read-only actions display the captured context without invoking an OS command', async () => {
    const selection = commands.prepareDesktopPlan(final('Read selected text'), context, null)
    assert.equal(await commands.approveDesktopPlan(selection.plan.id), context.focusedInput.selectedText)
    const app = commands.prepareDesktopPlan(final('What is the current app?'), context, null)
    assert.equal(await commands.approveDesktopPlan(app.plan.id), 'Fixture App')
    assert.equal(launches.length, 0)
    assert.equal(commands.prepareDesktopPlan(final('Read selected text'), { ...context, focusedInput: { isSecure: true } }, null).plan, undefined)
    assert.equal(commands.prepareDesktopPlan(final('Read selected text'), null, null).plan, undefined)
  })
  await test('execution can be cancelled and audit updates preserve the original ASR', async () => {
    const asr = final('Open Notes'), id = asr.sessionId
    rows.set(id, { id, modeMeta: JSON.stringify({ asr, transcript: asr.asrText }) })
    const plan = commands.prepareDesktopPlan(asr, context, id)
    holdLaunch = true
    const running = commands.approveDesktopPlan(plan.plan.id)
    commands.cancelDesktopPlan()
    await assert.rejects(running, /cancelled/)
    const meta = JSON.parse(rows.get(id).modeMeta)
    assert.equal(meta.desktopCommand.status, 'cancelled'); assert.equal(meta.asr.requestId, asr.requestId)
    assert.equal(meta.desktopCommand.events.map(event => event.status).join(','), 'approved,cancelled')
  })
  commands.cancelDesktopPlan()
  console.log(`PASS Desktop commands: ${checks} intent, final-ASR, confirmation, expiry, cancellation and audit scenarios`)
})().catch(error => { console.error(error); process.exitCode = 1 })
