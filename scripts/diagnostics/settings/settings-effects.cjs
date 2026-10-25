// Exercise real settings IPC, persistence and effects with isolated OS/transport boundaries.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const ts = require('typescript'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../../..')
function fixture({ platform = 'darwin' } = {}) {
  const handlers = new Map(), modules = new Map(), events = [], actions = [], windows = [[], []]
  let disk = {}, writes = 0, saveFails = false, themeFails = false, languageFails = false, theme = 'system'
  let loginFails = false, dockFails = false, loginTarget = false, dockVisible = true
  let nativeRunning = true, nativeAvailable = true, nativeResult = 0, nativeThrows = false, nativeTargets = '[]', fallbackFailure = null
  const registrations = new Map(), registrationAttempts = []
  let delaySystemLocale = false, finishSystemLocale
  let delayDockShow = false, finishDockShow
  class Store {
    constructor({ defaults }) { disk = structuredClone(defaults) }
    get(key) { return disk[key] }
    set(key, value) { disk[key] = value }
    get store() { return structuredClone(disk) }
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
      app: { getLocale: () => 'fr', setLoginItemSettings({ openAtLogin }) {
        actions.push('login')
        if (loginFails) throw new Error('login unavailable')
        loginTarget = openAtLogin
      }, dock: {
        async show() {
          actions.push('dock')
          if (dockFails) throw new Error('Dock unavailable')
          if (delayDockShow) await new Promise(resolve => { finishDockShow = resolve })
          dockVisible = true
        },
        hide() { actions.push('dock'); if (dockFails) throw new Error('Dock unavailable'); dockVisible = false }
      } },
      nativeTheme, systemPreferences: {},
      globalShortcut: {
        unregister(accelerator) { registrations.delete(accelerator) },
        register(accelerator, callback) {
          registrationAttempts.push(accelerator)
          if (fallbackFailure === 'throw') throw new Error('shortcut registration unavailable')
          if (fallbackFailure === 'false') return false
          registrations.set(accelerator, callback)
          return true
        }
      },
      safeStorage: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() }
    },
    'electron-store': { __esModule: true, default: Store },
    '../windows': { broadcast(channel, value) {
      if (languageFails && channel === 'i18n:language-changed') throw new Error('language notification unavailable')
      events.push({ channel, value: structuredClone(value) })
      windows.forEach(window => window.push({ channel, value: structuredClone(value) }))
    } },
    '../lib/logger': { createLogger: () => ({ warn() {}, error() {}, debug() {} }) },
    './logger': { createLogger: () => ({ warn() {}, error() {}, debug() {} }) },
    './appIdentity': {}, '../lib/native': { keyboard: {
      get running() { return nativeRunning },
      get updateTargetShortcuts() {
        return nativeAvailable ? targets => {
          actions.push('shortcuts')
          if (nativeThrows) throw new Error('native shortcut update unavailable')
          if (nativeResult === 0) nativeTargets = targets
          return nativeResult
        } : null
      }
    } }, '../lib/paths': {}, '../lib/sidecar': {},
    './recordingMachine': { recordingMachine: {} },
    './dictionaryLearning': { clearDictionaryLearning() {} },
    './desktopCommands': { cancelDesktopPlan() {} },
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
    vm.runInNewContext(source, { exports, require: req, process: { platform }, Buffer, structuredClone, console, setTimeout, clearTimeout }, { filename: file })
    return exports
  }
  load(path.join(root, 'src/main/ipc/system.ts')).registerSystemHandlers((channel, fn) => handlers.set(channel, fn))
  return {
    invoke: async (channel, ...args) => handlers.get(channel)({}, ...args),
    events, actions, windows, get writes() { return writes }, get disk() { return disk },
    set saveFails(value) { saveFails = value }, set themeFails(value) { themeFails = value },
    set languageFails(value) { languageFails = value },
    set loginFails(value) { loginFails = value }, set dockFails(value) { dockFails = value },
    get loginTarget() { return loginTarget }, get dockVisible() { return dockVisible },
    set nativeRunning(value) { nativeRunning = value }, set nativeResult(value) { nativeResult = value },
    set nativeAvailable(value) { nativeAvailable = value },
    set nativeThrows(value) { nativeThrows = value }, set fallbackFailure(value) { fallbackFailure = value },
    get nativeTargets() { return JSON.parse(nativeTargets) }, registrations, registrationAttempts,
    set delayDockShow(value) { delayDockShow = value }, finishDockShow() { finishDockShow() },
    set delaySystemLocale(value) { delaySystemLocale = value },
    finishSystemLocale() { finishSystemLocale() }
  }
}
async function test(name, run) { await run(); console.log('PASS ' + name) }
async function main() {
  await test('live transcript preview is saved and broadcast without changing recording settings', async () => {
    const f = fixture()
    const before = await f.invoke('store:use', 'get')
    assert.equal(before.showLiveTranscript, true)
    const saved = await f.invoke('store:use', 'patch', { showLiveTranscript: false })
    assert.equal(saved.showLiveTranscript, false)
    assert.equal(f.disk.settings.showLiveTranscript, false)
    assert.equal(f.events.some(event => event.channel === 'store:changed' && event.value.showLiveTranscript === false), true)
    assert.equal(JSON.stringify(saved.serviceProviders), JSON.stringify(before.serviceProviders))
    assert.equal(saved.polishLevel, before.polishLevel)
    assert.equal(saved.muteWhileDictating, before.muteWhileDictating)
    await assert.rejects(f.invoke('store:use', 'patch', { showLiveTranscript: 'false' }))
    assert.equal((await f.invoke('store:use', 'get')).showLiveTranscript, false)
    assert.equal((await f.invoke('store:use', 'reset')).showLiveTranscript, true)
  })
  await test('fallback-only publication cannot hide a missing updater after the native backend starts', async () => {
    const f = fixture()
    f.nativeRunning = false
    f.nativeAvailable = false
    const target = { shortcut: { accelerator: 'Control+K' } }
    await f.invoke('store:use', 'patch', target)
    assert.ok(f.registrations.has('Control+K'))
    f.nativeRunning = true
    await assert.rejects(f.invoke('store:use', 'patch', target), /Settings saved.*shortcuts/)
    f.nativeAvailable = true
    await f.invoke('store:use', 'patch', target)
    assert.ok(f.nativeTargets.includes('Control+K'))
    assert.equal(f.registrations.size, 0)
    assert.equal(f.writes, 3)
  })
  await test('reset saves once, reapplies default targets and broadcasts one actual settings snapshot', async () => {
    const f = fixture()
    await f.invoke('store:use', 'patch', { launchAtLogin: true, showInDock: false, appearancePreference: 'dark', shortcut: { accelerator: 'Control+K' } })
    const before = f.writes
    f.actions.length = 0
    f.events.length = 0
    const result = await f.invoke('store:use', 'reset')
    assert.equal(f.writes - before, 1)
    assert.equal(result.launchAtLogin, false)
    assert.equal(result.showInDock, true)
    assert.equal(result.appearancePreference, 'system')
    assert.equal(result.shortcut.accelerator, 'Fn')
    assert.equal(f.loginTarget, false)
    assert.equal(f.dockVisible, true)
    assert.ok(f.nativeTargets.includes('Fn'))
    assert.equal(f.actions.join(','), 'appearance,shortcuts,login,dock')
    assert.equal(f.events.filter(event => event.channel === 'store:changed').length, 1)
    assert.deepEqual(f.events.at(-1).value, structuredClone(result))
  })
  await test('Dock preferences still save and synchronize on platforms without a Dock', async () => {
    const f = fixture({ platform: 'linux' })
    assert.equal(await f.invoke('permission:update-show-app-in-dock', false), true)
    assert.equal(f.writes, 1)
    assert.equal(f.events.at(-1).value.showInDock, false)
    assert.equal(f.actions.length, 0)
    assert.deepEqual(f.windows[0], f.windows[1])
  })
  await test('a delayed Dock show cannot undo a newer saved hide preference', async () => {
    const f = fixture()
    f.delayDockShow = true
    const pending = f.invoke('store:use', 'patch', { showInDock: true })
    await f.invoke('permission:update-show-app-in-dock', false)
    assert.equal(f.dockVisible, false)
    f.finishDockShow()
    await pending
    assert.equal((await f.invoke('store:use', 'get')).showInDock, false)
    assert.equal(f.dockVisible, false)
    assert.equal(f.events.at(-1).value.showInDock, false)
    assert.deepEqual(f.windows[0], f.windows[1])
  })
  await test('login and Dock failures preserve saved state, report incomplete actions and allow the same target retry', async () => {
    for (const [channel, args, field, target, failure] of [
      ['store:use', ['patch', { launchAtLogin: true }], 'launchAtLogin', true, 'loginFails'],
      ['permission:update-auto-launch', [true], 'launchAtLogin', true, 'loginFails'],
      ['store:use', ['patch', { showInDock: false }], 'showInDock', false, 'dockFails'],
      ['permission:update-show-app-in-dock', [true], 'showInDock', true, 'dockFails']
    ]) {
      const f = fixture()
      f[failure] = true
      await assert.rejects(f.invoke(channel, ...args), /Settings saved, but (launch at startup|Dock visibility) could not be applied/)
      assert.equal(f.writes, 1)
      assert.equal((await f.invoke('store:use', 'get'))[field], target)
      assert.equal(f.events.at(-1).value[field], target)
      assert.deepEqual(f.windows[0], f.windows[1])
      f[failure] = false
      await f.invoke(channel, ...args)
      assert.equal(f.writes, 2)
      assert.equal(f.events.filter(event => event.channel === 'store:changed').length, 2)
      assert.equal(field === 'launchAtLogin' ? f.loginTarget : f.dockVisible, target)
      assert.equal(f.actions.join(','), field === 'launchAtLogin' ? 'login,login' : 'dock,dock')
    }
  })
  await test('each shortcut field republishes native targets without touching login items or Dock', async () => {
    for (const field of ['shortcut', 'commandShortcut', 'translationShortcut', 'askAnythingShortcut', 'additionalShortcuts']) {
      const f = fixture()
      const binding = { accelerator: 'Control+K', enabled: true, style: 'toggle' }
      const value = field === 'additionalShortcuts' ? { shortcut: [binding] } : binding
      await f.invoke('store:use', 'patch', { [field]: value })
      assert.equal(f.writes, 1)
      assert.ok(f.nativeTargets.includes('Control+K'), field)
      assert.equal(f.actions.join(','), 'shortcuts')
      assert.equal(f.events.filter(event => event.channel === 'store:changed').length, 1)
    }
  })
  await test('fallback shortcut rejection and exceptions report failure and retry saved targets', async () => {
    for (const failure of ['false', 'throw']) {
      const f = fixture()
      f.nativeRunning = false
      f.fallbackFailure = failure
      const target = { shortcut: { accelerator: 'Control+K' } }
      await assert.rejects(f.invoke('store:use', 'patch', target), /Settings saved.*shortcuts/)
      assert.equal(f.writes, 1)
      assert.equal(f.events.at(-1).value.shortcut.accelerator, 'Control+K')
      assert.equal(f.registrations.size, 0)
      assert.ok(f.registrationAttempts.includes('Control+K'))
      f.fallbackFailure = null
      await f.invoke('store:use', 'patch', target)
      assert.equal(f.writes, 2)
      assert.ok(f.registrations.has('Control+K'))
      assert.equal(f.registrationAttempts.filter(value => value === 'Control+K').length, 2)
    }
  })
  await test('native shortcut exceptions can be retried and a working fallback tolerates an inactive native updater failure', async () => {
    const f = fixture()
    const target = { shortcut: { accelerator: 'Control+K' } }
    f.nativeThrows = true
    await assert.rejects(f.invoke('store:use', 'patch', target), /Settings saved.*shortcuts/)
    f.nativeThrows = false
    await f.invoke('store:use', 'patch', target)
    assert.ok(f.nativeTargets.includes('Control+K'))
    const fallback = fixture()
    fallback.nativeRunning = false
    fallback.nativeResult = -1
    await fallback.invoke('store:use', 'patch', target)
    assert.ok(fallback.registrations.has('Control+K'))
    assert.equal(fallback.writes, 1)
  })
  await test('independent effect failures are all reported while the actual saved snapshot reaches every window', async () => {
    const f = fixture()
    f.nativeResult = -1
    f.loginFails = true
    f.dockFails = true
    await assert.rejects(f.invoke('store:use', 'patch', {
      shortcut: { accelerator: 'Control+K' }, launchAtLogin: true, showInDock: false
    }), error => /shortcuts/.test(error.message) && /launch at startup/.test(error.message) && /Dock visibility/.test(error.message))
    assert.equal(f.writes, 1)
    assert.equal(f.actions.join(','), 'shortcuts,login,dock')
    assert.equal(f.events.at(-1).value.launchAtLogin, true)
    assert.equal(f.events.at(-1).value.showInDock, false)
    assert.equal(f.events.at(-1).value.shortcut.accelerator, 'Control+K')
    assert.deepEqual(f.windows[0], f.windows[1])
  })
  await test('failed native shortcut publication reports the saved state and retries the same target', async () => {
    const f = fixture()
    const target = { shortcut: { accelerator: 'Control+K' } }
    f.nativeResult = -1
    await assert.rejects(f.invoke('store:use', 'patch', target), /Settings saved.*shortcuts/)
    assert.equal(f.writes, 1)
    assert.equal((await f.invoke('store:use', 'get')).shortcut.accelerator, 'Control+K')
    assert.equal(f.events.at(-1).value.shortcut.accelerator, 'Control+K')
    assert.deepEqual(f.nativeTargets, [])
    f.nativeResult = 0
    await f.invoke('store:use', 'patch', target)
    assert.equal(f.writes, 2)
    assert.ok(f.nativeTargets.includes('Control+K'))
    assert.equal(f.actions.join(','), 'shortcuts,shortcuts')
    assert.deepEqual(f.windows[0], f.windows[1])
  })
  await test('generic and compatible Dock changes each save once and only apply the saved visibility', async () => {
    const f = fixture()
    await f.invoke('store:use', 'patch', { showInDock: false })
    assert.equal(f.writes, 1)
    assert.equal(f.dockVisible, false)
    assert.equal(await f.invoke('permission:update-show-app-in-dock', true), true)
    assert.equal(f.writes, 2)
    assert.equal(f.dockVisible, true)
    assert.equal(f.actions.join(','), 'dock,dock')
    assert.equal(f.events.filter(event => event.channel === 'store:changed').length, 2)
    assert.equal(f.events.at(-1).value.showInDock, true)
    assert.deepEqual(f.windows[0], f.windows[1])
  })
  await test('generic and compatible login changes each save once and only apply the saved login target', async () => {
    const f = fixture()
    await f.invoke('store:use', 'patch', { launchAtLogin: true })
    assert.equal(f.writes, 1)
    assert.equal(f.loginTarget, true)
    assert.equal(await f.invoke('permission:update-auto-launch', false), true)
    assert.equal(f.writes, 2)
    assert.equal(f.loginTarget, false)
    assert.equal(f.actions.join(','), 'login,login')
    assert.equal(f.events.filter(event => event.channel === 'store:changed').length, 2)
    assert.equal(f.events.at(-1).value.launchAtLogin, false)
    assert.deepEqual(f.windows[0], f.windows[1])
  })
  await test('audio and history settings save and broadcast without changing shortcuts, login items or Dock', async () => {
    const f = fixture()
    const result = await f.invoke('store:use', 'patch', { micDevice: 'test-microphone', historyEnabled: false })
    assert.equal(result.micDevice, 'test-microphone')
    assert.equal(result.historyEnabled, false)
    assert.equal(f.writes, 1)
    assert.deepEqual(f.actions, [])
    assert.equal(f.events.length, 1)
    assert.equal(f.events[0].channel, 'store:changed')
    assert.equal(f.events[0].value.historyEnabled, false)
    assert.deepEqual(f.windows[0], f.windows[1])
  })
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
      ['i18n:set-language', ['zh-CN']], ['appearance:set-preference', ['dark']],
      ['store:use', ['patch', { launchAtLogin: true, showInDock: false, shortcut: { accelerator: 'Control+K' } }]],
      ['permission:update-auto-launch', [true]], ['permission:update-show-app-in-dock', [false]]
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
    await assert.rejects(f.invoke('store:use', 'patch', { launchAtLogin: 'yes' }))
    await assert.rejects(f.invoke('store:use', 'patch', { showInDock: 'no' }))
    await assert.rejects(f.invoke('permission:update-auto-launch', 'yes'))
    await assert.rejects(f.invoke('permission:update-show-app-in-dock', 'no'))
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
