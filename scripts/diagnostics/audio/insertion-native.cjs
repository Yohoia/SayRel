// Opt-in actual native paste into this process's synthetic textarea only.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('typescript')
const koffi = require('koffi')
const root = path.resolve(__dirname, '../../..')
if (!process.argv.includes('--native')) throw new Error('Pass --native to open the synthetic native insertion test window')
const reportIndex = process.argv.indexOf('--evaluation-report')
let text = 'Verified synthetic text 🙂'
if (reportIndex >= 0) {
  const reportPath = process.argv[reportIndex + 1]
  if (!reportPath) throw new Error('--evaluation-report requires a synthetic evaluation results.json path')
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
  assert.equal(report.syntheticOnly, true, 'only explicitly synthetic evaluation output may be replayed')
  const row = report.rows?.find(row => row.id === 'tour-todo-zh-actionable-not-narrated' && row.level === 'strong')
  assert.equal(typeof row?.output, 'string', 'report must contain the real-model Chinese to-do result')
  assert.equal(row.error, undefined, 'do not replay a failed model request')
  assert(row.output.length > 0 && row.output.length < 4000)
  assert.doesNotMatch(row.output, /[（）()]/, 'the replayed result must not introduce parenthetical annotations')
  text = row.output
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sayrel-native-insertion-'))
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-background-networking')
let win
app.whenReady().then(async () => {
  const lib = koffi.load(path.join(root, 'resources/lib/InputHelper/build/libInputHelper.dylib'))
  const check = lib.func('checkAccessibilityPermission', 'int', ['int'])
  if (!check(0)) { console.log('SKIP native insertion: accessibility permission unavailable; no prompt or input dispatch'); return }
  const get = lib.func('getCurrentInputState', 'void *', ['int']), free = lib.func('freeString', 'void', ['void *'])
  const input = { available: true, insertText: lib.func('insertText', 'int', ['char *']), getCurrentInputState(timeout) {
    const ptr = get(timeout)
    if (!ptr) return ''
    try { return koffi.decode(ptr, 'char', -1) } finally { free(ptr) }
  } }
  const cache = new Map(), mocks = {
    '../lib/native': { input }, '../lib/logger': { createLogger: () => ({ warn() {}, error() {} }) }
  }
  function load(file) {
    const absolute = path.resolve(root, file.endsWith('.ts') ? file : file + '.ts')
    if (cache.has(absolute)) return cache.get(absolute)
    const exports = {}; cache.set(absolute, exports)
    const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
    vm.runInNewContext(code, { exports, setTimeout, Date, require: id => mocks[id] ?? (id.startsWith('.') ? load(path.resolve(path.dirname(absolute), id)) : require(id)) }, { filename: absolute })
    return exports
  }
  const insertion = load('src/main/services/insertion.ts')
  app.setAccessibilitySupportEnabled(true)
  win = new BrowserWindow({ width: 620, height: 280, title: 'Sayrel insertion verification (synthetic text only)', webPreferences: { sandbox: true } })
  await win.loadURL('data:text/html,' + encodeURIComponent('<h2>Sayrel synthetic insertion test</h2><p>This window contains no user data.</p><textarea style="width:95%;height:100px" aria-label="Synthetic insertion target">Test: </textarea>'))
  app.focus({ steal: true }); win.focus()
  await win.webContents.executeJavaScript('document.querySelector("textarea").focus(); document.querySelector("textarea").setSelectionRange(6,6)')
  await new Promise(resolve => setTimeout(resolve, 250))
  if (!win.isFocused()) { console.log('SKIP native insertion: fixture window lost focus; no dispatch'); return }
  const before = insertion.readInputState(80)
  if (before?.value !== 'Test: ') { console.log('SKIP native insertion: AX did not expose the owned fixture textarea; no dispatch'); return }
  const result = await insertion.insertText(text, { addTrailingSpace: false, isCancelled: () => !win.isFocused() })
  const actual = await win.webContents.executeJavaScript('document.querySelector("textarea").value')
  assert.equal(actual, 'Test: ' + text, 'the actual textarea receives the exact Unicode payload')
  assert.equal(result.verification, 'verified', 'the actual AX snapshot confirms this write')
  await new Promise(resolve => setTimeout(resolve, 300))
  console.log('PASS actual native dispatch and AX verification into the owned synthetic textarea' + (reportIndex >= 0 ? ' using the real-model multiline Chinese result' : ''))
}).then(() => { win?.destroy(); app.exit(0) }).catch(error => { console.error(error); win?.destroy(); app.exit(1) })
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }))
