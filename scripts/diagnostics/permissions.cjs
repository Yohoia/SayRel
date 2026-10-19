// Deferred investigation: the user reported restart resolved the symptom; not part of regression commands.
// Drives actual permission IPC handlers with isolated OS/native boundaries.
// Does not prompt, change TCC, open System Settings, or access user data.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const ts = require('typescript'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..')
const noop = () => {}
function fixture({ trusted = true, helperAvailable = true, helperTrusted = trusted, keyboardThrows = false, media = 'granted' } = {}) {
  const handlers = new Map(), opened = [], prompts = [], keyboardCalls = []
  const native = {
    util: helperAvailable ? { checkAccessibilityPermission: () => +helperTrusted } : {}, input: {},
    keyboard: { running: false, start() { keyboardCalls.push('start'); if (keyboardThrows) throw new Error('tap unavailable'); this.running = true; return 0 }, stop: noop }
  }
  const mocks = {
    electron: {
      app: { isPackaged: false, getName: () => 'offkey', getPath: () => '/fixture/Electron.app/Contents/MacOS/Electron', getAppPath: () => '/fixture/offkey' },
      systemPreferences: { isTrustedAccessibilityClient: prompt => { prompts.push(prompt); return trusted }, getMediaAccessStatus: () => media, askForMediaAccess: async () => false },
      shell: { openExternal: async url => opened.push(url), showItemInFolder: noop },
      clipboard: {}, dialog: {}, nativeImage: {}
    },
    '../lib/native': native,
    '../lib/settings': { settings: { get: () => ({}) } },
    '../lib/paths': { paths: {} },
    '../lib/logger': { createLogger: () => ({ warn: noop, error: noop, debug: noop, info: noop }) },
    '../services/shortcutRegistration': { refreshShortcutRegistrations: noop },
    '../windows': { broadcast: noop }
  }
  const cache = new Map()
  function load(file) {
    if (cache.has(file)) return cache.get(file)
    const exports = {}; cache.set(file, exports)
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const req = id => {
      if (id in mocks) return mocks[id]
      if (id.startsWith('node:')) return require(id)
      if (id === './permissions' || id === '../services/permissions') return load(path.resolve(path.dirname(file), id + '.ts'))
      return {}
    }
    vm.runInNewContext(source, { exports, require: req, process: { platform: 'darwin', execPath: '/fixture/Electron.app/Contents/MacOS/Electron' }, console, setTimeout, clearTimeout, Date }, { filename: file })
    return exports
  }
  load(path.join(root, 'src/main/ipc/system.ts')).registerSystemHandlers((channel, fn) => handlers.set(channel, fn))
  return { invoke: (channel, ...args) => handlers.get(channel)({}, ...args), opened, prompts, keyboardCalls }
}
const cases = [
  ['OS grant is recognized when optional native helper is missing', async () => {
    const f = fixture({ helperAvailable: false })
    assert.equal(await f.invoke('permission:check-with-child-process', 'accessibility'), true)
  }],
  ['OS grant is recognized when native helper reports a stale denial', async () => {
    const f = fixture({ helperTrusted: false })
    assert.equal(await f.invoke('permission:check-with-child-process', 'accessibility'), true)
  }],
  ['keyboard restart failure cannot hide an existing OS grant', async () => {
    const f = fixture({ keyboardThrows: true })
    assert.equal(await f.invoke('permission:check-with-child-process', 'accessibility'), true)
  }],
  ['denied current process never borrows another helper grant', async () => {
    const f = fixture({ trusted: false, helperTrusted: true })
    assert.equal(await f.invoke('permission:check-with-child-process', 'accessibility'), false)
  }],
  ['accessibility request opens the correct system pane even without helpers', async () => {
    const f = fixture({ trusted: false, helperAvailable: false })
    assert.equal(await f.invoke('permission:request', 'accessibility'), false)
    assert.ok(f.opened.some(url => url.endsWith('Privacy_Accessibility')))
    assert.ok(f.prompts.includes(true))
  }],
  ['previously denied microphone opens settings for recovery', async () => {
    const f = fixture({ media: 'denied' })
    assert.equal(await f.invoke('permission:request', 'microphone'), false)
    assert.ok(f.opened.some(url => url.endsWith('Privacy_Microphone')))
  }]
]
;(async () => {
  let failed = 0
  for (const [name, run] of cases) {
    try { await run(); console.log('PASS ' + name) }
    catch (error) { failed++; console.log('FAIL ' + name + ': ' + error.message) }
  }
  process.exitCode = failed ? 1 : 0
})()
