// Exercise real settings IPC, persistence and effects with isolated OS/transport boundaries.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const ts = require('typescript'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..')
function fixture() {
  const handlers = new Map(), modules = new Map(), events = [], actions = [], windows = [[], []]
  let disk = {}, writes = 0, saveFails = false, themeFails = false, languageFails = false, theme = 'system'
  let delaySystemLocale = false, finishSystemLocale
  class Store {
    constructor({ defaults }) { disk = structuredClone(defaults) }
    get(key) { return disk[key] }
    set(key, value) { disk[key] = value }
    set store(value) {
      if (saveFails) throw new Error('disk unavailable')
      disk = structuredClone(value); writes++
    }
  }
  const nativeTheme = {
    get themeSource() { return theme },
    set themeSource(value) {
      actions.push('appearance')
      if (themeFails) throw new Error('theme unavailable')
      theme = value
    },
    get shouldUseDarkColors() { return theme === 'dark' }, on() {}
  }
  const mocks = {
    electron: {
      app: { getLocale: () => 'fr', setLoginItemSettings() { actions.push('login') }, dock: { show() { actions.push('dock') }, hide() { actions.push('dock') } } },
      nativeTheme, systemPreferences: {},
      safeStorage: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() }
    },
    'electron-store': { __esModule: true, default: Store },
    '../windows': { broadcast(channel, value) {
      if (languageFails && channel === 'i18n:language-changed') throw new Error('language notification unavailable')
      events.push({ channel, value: structuredClone(value) })
      windows.forEach(window => window.push({ channel, value: structuredClone(value) }))
    } },
    '../services/shortcutRegistration': { refreshShortcutRegistrations() { actions.push('shortcuts') } },
    './shortcutRegistration': { refreshShortcutRegistrations() { actions.push('shortcuts') } },
    '../lib/logger': { createLogger: () => ({ warn() {}, error() {}, debug() {} }) },
    './logger': { createLogger: () => ({ warn() {}, error() {}, debug() {} }) },
    './appIdentity': {}, '../lib/native': {}, '../lib/paths': {}, '../lib/sidecar': {},
    '../services/contextCapture': {}, '../services/dictionary': {},
    'node:child_process': { execFile(_file, _args, callback) {
      const finish = () => callback(null, { stdout: 'fr', stderr: '' })
      if (delaySystemLocale) finishSystemLocale = finish
      else finish()
    } }
  }
  function load(file) {
    if (modules.has(file)) return modules.get(file)
    const exports = {}; modules.set(file, exports)
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    function req(id) {
      if (id in mocks) return mocks[id]
      if (!id.startsWith('.')) return require(id)
      return load(path.resolve(path.dirname(file), id + '.ts'))
    }
    vm.runInNewContext(source, { exports, require: req, process: { platform: 'darwin' }, Buffer, structuredClone, console, setTimeout, clearTimeout }, { filename: file })
    return exports
  }
  load(path.join(root, 'src/main/ipc/system.ts')).registerSystemHandlers((channel, fn) => handlers.set(channel, fn))
  return {
    invoke: async (channel, ...args) => handlers.get(channel)({}, ...args),
    events, actions, windows, get writes() { return writes }, get disk() { return disk },
    set saveFails(value) { saveFails = value }, set themeFails(value) { themeFails = value },
    set languageFails(value) { languageFails = value },
    set delaySystemLocale(value) { delaySystemLocale = value },
    finishSystemLocale() { finishSystemLocale() }
  }
}
async function test(name, run) { await run(); console.log('PASS ' + name) }
async function main() {
  await test('generic language changes save once, notify windows and leave unrelated OS settings alone', async () => {
    const f = fixture()
    const result = await f.invoke('store:use', 'patch', { language: 'zh-CN' })
    assert.equal(result.language, 'zh-CN')
    assert.equal(f.writes, 1)
    assert.equal(f.actions.length, 0, 'language must not refresh shortcuts, login items or Dock')
    assert.equal(f.events.find(event => event.channel === 'store:changed').value.language, 'zh-CN')
    assert.equal(f.events.find(event => event.channel === 'i18n:language-changed').value, 'zh-CN')
  })
  await test('saved appearance remains synchronized after effect failure and the same target can be retried', async () => {
    const f = fixture()
    f.themeFails = true
    await assert.rejects(f.invoke('appearance:set-preference', 'dark'), /Settings saved.*appearance/)
    assert.equal(f.writes, 1)
    assert.equal((await f.invoke('store:use', 'get')).appearancePreference, 'dark')
    assert.equal(f.events.find(event => event.channel === 'store:changed').value.appearancePreference, 'dark')
    assert.equal(f.events.some(event => event.channel === 'appearance:color-mode-changed'), false)
    f.themeFails = false
    const state = await f.invoke('appearance:set-preference', 'dark')
    assert.equal(state.colorMode, 'dark')
    assert.equal(state.resolved, 'dark')
    assert.equal(f.writes, 2)
    assert.equal(f.actions.join(','), 'appearance,appearance')
    assert.equal(f.events.filter(event => event.channel === 'store:changed').length, 2)
  })
  await test('generic and compatible language entries normalize and persist once per operation', async () => {
    const f = fixture()
    assert.equal(await f.invoke('i18n:set-language', 'en-US'), 'en')
    assert.equal(f.writes, 1)
    assert.equal((await f.invoke('store:use', 'patch', { language: 'zh_CN' })).language, 'zh-CN')
    assert.equal(f.writes, 2)
    assert.equal(f.actions.length, 0)
    assert.deepEqual(f.windows[0], f.windows[1])
    assert.equal(f.windows[1].at(-1).value.language, 'zh-CN')
  })
  await test('generic and compatible appearance entries apply only the saved preference', async () => {
    const f = fixture()
    await f.invoke('store:use', 'patch', { appearancePreference: 'dark' })
    const state = await f.invoke('appearance:set-preference', 'system')
    assert.equal(state.colorMode, 'system')
    assert.equal(state.resolved, 'light')
    assert.equal(f.writes, 2)
    assert.equal(f.actions.join(','), 'appearance,appearance')
    assert.deepEqual(f.windows[0], f.windows[1])
    assert.equal(f.events.filter(event => event.channel === 'appearance:color-mode-changed').length, 2)
  })
  await test('failed persistence leaves the saved snapshot and all effects untouched', async () => {
    for (const [channel, args] of [
      ['store:use', ['patch', { language: 'zh-CN', appearancePreference: 'dark' }]],
      ['i18n:set-language', ['zh-CN']], ['appearance:set-preference', ['dark']]
    ]) {
      const f = fixture()
      const before = structuredClone(await f.invoke('store:use', 'get'))
      f.saveFails = true
      await assert.rejects(f.invoke(channel, ...args), /disk unavailable/)
      assert.deepEqual(structuredClone(await f.invoke('store:use', 'get')), before)
      assert.equal(f.writes, 0)
      assert.equal(f.actions.length, 0)
      assert.equal(f.events.length, 0)
    }
  })
  await test('invalid preferences are rejected before saving or applying', async () => {
    const f = fixture()
    await assert.rejects(f.invoke('appearance:set-preference', 'sepia'))
    await assert.rejects(f.invoke('store:use', 'patch', { language: 42 }))
    assert.equal(f.writes, 0)
    assert.equal(f.events.length, 0)
    assert.equal(f.actions.length, 0)
  })
  await test('resetting language resolves system locale while keeping the saved preference automatic', async () => {
    const f = fixture()
    assert.equal(await f.invoke('i18n:reset-to-system-language'), 'fr')
    assert.equal((await f.invoke('store:use', 'get')).language, null)
    assert.equal(f.events.find(event => event.channel === 'i18n:language-changed').value, 'fr')
    assert.equal(f.writes, 1)
    assert.equal(f.actions.length, 0)
  })
  await test('failed language notification preserves both saved preferences and does not prevent appearance applying', async () => {
    const f = fixture()
    f.languageFails = true
    await assert.rejects(f.invoke('store:use', 'patch', { language: 'zh-CN', appearancePreference: 'dark' }), /Settings saved.*language/)
    assert.equal(f.writes, 1)
    assert.equal(f.events.find(event => event.channel === 'store:changed').value.language, 'zh-CN')
    assert.equal(f.events.find(event => event.channel === 'appearance:color-mode-changed').value.resolved, 'dark')
    f.languageFails = false
    assert.equal(await f.invoke('i18n:set-language', 'zh-CN'), 'zh-CN')
    assert.equal(f.writes, 2)
    assert.equal(f.events.find(event => event.channel === 'i18n:language-changed').value, 'zh-CN')
  })
  await test('a delayed system locale cannot overwrite a newer saved language in any window', async () => {
    const f = fixture()
    f.delaySystemLocale = true
    const pending = f.invoke('i18n:reset-to-system-language')
    await f.invoke('store:use', 'patch', { language: 'zh-CN' })
    f.finishSystemLocale()
    await pending
    assert.equal(f.writes, 2)
    assert.equal(f.events.filter(event => event.channel === 'i18n:language-changed').map(event => event.value).join(','), 'zh-CN')
    assert.equal(f.events.at(-1).value.language, 'zh-CN')
    assert.deepEqual(f.windows[0], f.windows[1])
  })
}
main().catch(error => { console.error(error); process.exitCode = 1 })
