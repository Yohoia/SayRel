// Exercises the actual data model and registration path; no Electron launch.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const ts = require('typescript'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..'), cache = new Map()
const logger = { debug() {}, warn() {}, error() {} }
let config, targets = '', nativeRunning = true
const electronShortcuts = new Map()
const mocks = {
  '../lib/logger': { createLogger: () => logger },
  '../lib/settings': { settings: { get: () => config } },
  '../windows': { windows: {} },
  './recordingMachine': { recordingMachine: {} },
  '../lib/native': { keyboard: { get running() { return nativeRunning }, updateTargetShortcuts(value) { targets = value; return 0 } } },
  electron: { globalShortcut: { unregister(value) { electronShortcuts.delete(value) }, register(value, callback) { electronShortcuts.set(value, callback); return true } } }
}
function load(file) {
  if (cache.has(file)) return cache.get(file)
  const exports = {}; cache.set(file, exports)
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(source, { exports, require(id) { return mocks[id] ?? (id.startsWith('.') ? load(path.relative(root, path.resolve(root, path.dirname(file), id + '.ts'))) : require(id)) }, setTimeout, clearTimeout, console })
  return exports
}
function test(name, fn) { fn(); console.log('PASS ' + name) }
const { DEFAULT_SETTINGS, mergeSettings } = load('src/shared/settings.ts')
const { bindingsFor, normalizeTranslationTargets, validateShortcut } = load('src/shared/settingsControls.ts')
const { refreshShortcutRegistrations } = load('src/main/services/shortcutRegistration.ts')
config = structuredClone(DEFAULT_SETTINGS)
test('saved single translation language is preserved and gets a candidate list', () => {
  const settings = mergeSettings({ translationTargetLanguage: 'ja' })
  assert.equal(settings.translationTargetLanguages.join(','), 'ja')
  assert.equal(settings.translationTargetLanguage, 'ja')
})
test('translation candidates deduplicate, cap at three, and never become empty', () => {
  const value = normalizeTranslationTargets(['en', 'ja', 'en', 'fr', 'de'], 'ja')
  assert.equal(value.translationTargetLanguages.join(','), 'en,ja,fr')
  assert.equal(value.translationTargetLanguage, 'ja')
  assert.equal(normalizeTranslationTargets([], 'de').translationTargetLanguages[0], 'de')
})
test('removing the selected translation language selects a valid remaining target', () => {
  assert.equal(normalizeTranslationTargets(['ja', 'fr'], 'en').translationTargetLanguage, 'ja')
})
test('shortcut validation catches reordered collisions, reserved keys and invalid chords', () => {
  assert.ok(validateShortcut('Shift+Alt+K', ['Alt+Shift+K']))
  assert.ok(validateShortcut('K', []))
  assert.ok(validateShortcut('Control+A+B', []))
  assert.ok(validateShortcut('Control+1+2', []))
  assert.ok(validateShortcut('Q+Command', []))
  assert.ok(validateShortcut('Command+Control+Alt+K', []))
  assert.equal(validateShortcut('Fn', []), null)
  assert.equal(validateShortcut('Mouse4', []), null)
})
test('extra shortcuts actually register; removal and disabled modes unregister them', () => {
  config.additionalShortcuts = { shortcut: [{ accelerator: 'Control+K', enabled: true, style: 'toggle' }] }
  refreshShortcutRegistrations()
  assert.ok(JSON.parse(targets).includes('Control+K'))
  assert.equal(bindingsFor(config, 'shortcut').length, 2)
  nativeRunning = false; refreshShortcutRegistrations()
  assert.ok(electronShortcuts.has('Control+K'))
  config.additionalShortcuts = {}; config.translationShortcut.enabled = false
  refreshShortcutRegistrations()
  assert.ok(!electronShortcuts.has('Control+K'))
  assert.ok(!JSON.parse(targets).includes('Fn+Shift'))
})
const { EventEmitter } = require('node:events')
const window = new EventEmitter(), sender = new EventEmitter()
sender.id = 17; sender.isDestroyed = () => false
let disabled = false, captureEnabled = false, listeners = 0, keyListener = null, sentEvents = [], failCaptureStart = false
sender.send = (...args) => sentEvents.push(args)
Object.assign(mocks.electron, { BrowserWindow: { fromWebContents: () => window } })
mocks.electron.globalShortcut.unregisterAll = () => electronShortcuts.clear()
Object.assign(mocks['../lib/native'].keyboard, {
  setShortcutCaptureEnabled(value) { if (value && failCaptureStart) throw new Error('capture initialization failed'); captureEnabled = Boolean(value) },
  onKey(callback) { listeners++; keyListener = callback; return () => { listeners--; keyListener = null } }
})
mocks['../services/recordingMachine'] = { recordingMachine: Object.assign(new EventEmitter(), {
  getState: () => ({ phase: 'idle' }), isDisabled: () => disabled,
  setDisabled(value) { disabled = value }
}) }
mocks['../services/insertion'] = {}; mocks['../services/dictionary'] = {}
const handlers = new Map()
load('src/main/ipc/misc.ts').registerMiscHandlers((channel, handler) => handlers.set(channel, handler))
test('shortcut capture suspends dictation and releases all listeners on window blur', () => {
  handlers.get('keyboard:begin-shortcut-capture')({ sender })
  assert.equal(disabled, true); assert.equal(captureEnabled, true); assert.equal(listeners, 1)
  window.emit('blur')
  assert.equal(disabled, false); assert.equal(captureEnabled, false); assert.equal(listeners, 0)
  assert.equal(sender.listenerCount('destroyed'), 0)
})
test('only the owning window can end capture; renderer crash restores prior disabled state', () => {
  disabled = true
  const first = handlers.get('keyboard:begin-shortcut-capture')({ sender })
  const second = handlers.get('keyboard:begin-shortcut-capture')({ sender })
  assert.notEqual(first.sessionId, second.sessionId)
  const other = new EventEmitter(); other.id = 18; other.isDestroyed = () => false; other.send = () => {}
  assert.throws(() => handlers.get('keyboard:begin-shortcut-capture')({ sender: other }), /owned by another window/)
  handlers.get('keyboard:end-shortcut-capture')({ sender: { id: 18 } }, second.sessionId)
  handlers.get('keyboard:end-shortcut-capture')({ sender }, first.sessionId)
  assert.equal(captureEnabled, true)
  assert.equal(listeners, 1, 'stale end requests do not release a newer capture')
  keyListener({ combination: 'Fn', pressed: true, capture: true })
  assert.equal(sentEvents.at(-1)[0], 'keyboard:shortcut-captured')
  assert.equal(sentEvents.at(-1)[1].sessionId, second.sessionId)
  sender.emit('render-process-gone')
  assert.equal(captureEnabled, false); assert.equal(disabled, true); assert.equal(listeners, 0)
})

test('failed capture initialization restores shortcuts and permits a fresh owner', () => {
  disabled = false
  failCaptureStart = true
  assert.throws(() => handlers.get('keyboard:begin-shortcut-capture')({ sender }), /capture initialization failed/)
  assert.equal(disabled, false)
  assert.equal(listeners, 0)
  assert.ok(electronShortcuts.size > 0, 'fallback shortcuts are restored')
  failCaptureStart = false
  const other = new EventEmitter(); other.id = 18; other.isDestroyed = () => false; other.send = () => {}
  const result = handlers.get('keyboard:begin-shortcut-capture')({ sender: other })
  handlers.get('keyboard:end-shortcut-capture')({ sender: other }, result.sessionId)
  handlers.get('keyboard:end-shortcut-capture')({ sender: other }, result.sessionId)
  assert.equal(listeners, 0)
  assert.equal(disabled, false)
})

test('saved Fn keycodes migrate across primary and additional bindings', () => {
  const state = mergeSettings({ shortcut: { ...DEFAULT_SETTINGS.shortcut, accelerator: 'KeyCode179' }, translationShortcut: { ...DEFAULT_SETTINGS.translationShortcut, accelerator: 'Fn+KeyCode179+LeftShift' }, additionalShortcuts: { askAnythingShortcut: [{ accelerator: 'KeyCode63+Space', enabled: true, style: 'toggle' }] } })
  assert.equal(state.shortcut.accelerator, 'Fn')
  assert.equal(state.translationShortcut.accelerator, 'Fn+LeftShift')
  assert.equal(state.additionalShortcuts.askAnythingShortcut[0].accelerator, 'Fn+Space')
})
test('shortcuts expose readable key names without symbol glyphs', () => {
  const { shortcutLabels } = load('src/shared/settingsControls.ts')
  assert.equal(shortcutLabels('Fn+LeftShift+Space').join(', '), 'Fn, Left Shift, Space')
})
