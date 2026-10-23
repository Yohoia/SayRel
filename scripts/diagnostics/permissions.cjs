// Drives actual permission IPC handlers with isolated OS/native boundaries.
// Does not prompt, change TCC, open System Settings, or access user data.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const ts = require('typescript'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..')
const noop = () => {}
function fixture({ trusted = true, helperAvailable = true, helperTrusted = trusted, keyboardThrows = false, media = 'granted', mediaGrant = false, onboardingCompleted = true } = {}) {
  const handlers = new Map(), opened = [], prompts = [], keyboardCalls = []
  const windowCalls = [], events = [], actions = []
  let disk, writes = 0, saveFails = false
  class Store {
    constructor({ defaults }) { disk = { ...structuredClone(defaults), settings: { ...structuredClone(defaults.settings), onboardingCompleted, language: 'zh-CN', translationTargetLanguages: ['en', 'ja'] } } }
    get(key) { return disk[key] }
    set(key, value) { disk[key] = value }
    set store(value) {
      if (saveFails) throw new Error('disk unavailable')
      disk = structuredClone(value); writes++
    }
  }
  const native = {
    util: helperAvailable ? { checkAccessibilityPermission: () => +helperTrusted } : {}, input: {}, context: { available: false },
    keyboard: { running: false, updateTargetShortcuts() { actions.push('shortcuts'); return 0 }, start() { keyboardCalls.push('start'); if (keyboardThrows) throw new Error('tap unavailable'); this.running = true; return 0 }, stop: noop }
  }
  const mocks = {
    electron: {
      app: { isPackaged: false, getName: () => 'sayrel', getPath: () => '/fixture/Electron.app/Contents/MacOS/Electron', getAppPath: () => '/fixture/sayrel', getLocale: () => 'en', setLoginItemSettings() { actions.push('login') }, dock: { show() { actions.push('dock') }, hide() { actions.push('dock') } } },
      systemPreferences: { isTrustedAccessibilityClient: prompt => { prompts.push(prompt); return trusted }, getMediaAccessStatus: () => media, askForMediaAccess: async () => { prompts.push('microphone'); return mediaGrant } },
      shell: { openExternal: async url => opened.push(url), showItemInFolder: noop },
      clipboard: {}, dialog: {}, nativeImage: {}, nativeTheme: {},
      globalShortcut: { register() { actions.push('fallback'); return true }, unregister: noop },
      safeStorage: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() }
    },
    'electron-store': { __esModule: true, default: Store },
    './appIdentity': {},
    '../lib/native': native,
    '../lib/paths': { paths: {} },
    '../lib/logger': { createLogger: () => ({ warn: noop, error: noop, debug: noop, info: noop }) },
    './logger': { createLogger: () => ({ warn: noop, error: noop, debug: noop, info: noop }) },
    '../lib/sidecar': {}, '../lib/workers': {},
    '../db': { schema: { historyV2: {}, dictionary: {} } },
    '../windows': { broadcast(channel, value) { events.push({ channel, value: structuredClone(value) }) }, openHub: () => windowCalls.push('hub'), onboardingWindow: {
      createWindow: () => windowCalls.push('create'), show: () => windowCalls.push('show'), closeWindow: () => windowCalls.push('close')
    } }
  }
  const cache = new Map()
  function load(file) {
    if (cache.has(file)) return cache.get(file)
    const exports = {}; cache.set(file, exports)
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const req = id => {
      if (id in mocks) return mocks[id]
      if (!id.startsWith('.')) return require(id)
      const target = path.resolve(path.dirname(file), id)
      return load(fs.existsSync(target + '.ts') ? target + '.ts' : path.join(target, 'index.ts'))
    }
    vm.runInNewContext(source, { exports, require: req, process: { platform: 'darwin', execPath: '/fixture/Electron.app/Contents/MacOS/Electron' }, console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Buffer, URL, AbortController, AbortSignal, structuredClone }, { filename: file })
    return exports
  }
  load(path.join(root, 'src/main/ipc/system.ts')).registerSystemHandlers((channel, fn) => handlers.set(channel, fn))
  load(path.join(root, 'src/main/ipc/windows.ts')).registerWindowHandlers((channel, fn) => handlers.set(channel, fn))
  load(path.join(root, 'src/main/ipc/providers.ts')).registerProviderHandlers((channel, fn) => handlers.set(channel, fn))
  const settings = load(path.join(root, 'src/main/lib/settings.ts')).settings
  return { invoke: (channel, ...args) => handlers.get(channel)({}, ...args), opened, prompts, keyboardCalls, get stored() { return settings.get() }, windowCalls, events, actions, get writes() { return writes }, get disk() { return disk }, set saveFails(value) { saveFails = value } }
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
    assert.ok(!f.prompts.includes('microphone'))
  }],
  ['first microphone request uses the OS prompt and returns its result', async () => {
    const f = fixture({ media: 'not-determined', mediaGrant: true })
    assert.equal(await f.invoke('permission:request', 'microphone'), true)
    assert.ok(f.prompts.includes('microphone'))
    assert.equal(f.opened.length, 0)
  }],
  ['each permission can be managed after being granted', async () => {
    const f = fixture()
    for (const [kind, pane] of [['microphone', 'Microphone'], ['accessibility', 'Accessibility'], ['screenRecording', 'ScreenCapture']]) {
      assert.equal(await f.invoke('permission:open-system-preferences', kind), true)
      assert.ok(f.opened.at(-1).endsWith('Privacy_' + pane))
    }
  }],
  ['invalid permission input cannot open arbitrary system panes', async () => {
    const f = fixture()
    await assert.rejects(() => f.invoke('permission:open-system-preferences', 'anything'))
    assert.equal(f.opened.length, 0)
  }],
  ['completed setup can be reopened without clearing the completion flag', async () => {
    const f = fixture()
    f.invoke('page:open-entry-window')
    assert.deepEqual(f.windowCalls, ['hub'])
    f.invoke('page:open-onboarding')
    assert.deepEqual(f.windowCalls, ['hub', 'create', 'show'])
    assert.equal(f.stored.onboardingCompleted, true)
  }],
  ['unfinished setup opens automatically and only completion updates the flag', async () => {
    const f = fixture({ onboardingCompleted:false })
    f.invoke('page:open-entry-window')
    assert.deepEqual(f.windowCalls, ['create', 'show'])
    assert.equal(f.stored.onboardingCompleted, false)
    assert.equal(await f.invoke('page:complete-onboarding'), true)
    assert.equal(f.stored.onboardingCompleted, true)
    assert.deepEqual(f.windowCalls.slice(-2), ['close', 'hub'])
    assert.equal(f.writes, 1)
    assert.equal(f.events.length, 1)
    assert.equal(f.events[0].channel, 'store:changed')
    assert.equal(f.events[0].value.onboardingCompleted, true)
    assert.deepEqual(f.actions, [])
  }],
  ['failed onboarding persistence keeps setup open and does not broadcast success', async () => {
    const f = fixture({ onboardingCompleted: false })
    f.saveFails = true
    await assert.rejects(async () => f.invoke('page:complete-onboarding'), /disk unavailable/)
    assert.equal(f.stored.onboardingCompleted, false)
    assert.equal(f.writes, 0)
    assert.deepEqual(f.events, [])
    assert.deepEqual(f.windowCalls, [])
  }],
  ['floating translation changes save once, broadcast and retain language selection validation', async () => {
    const f = fixture()
    assert.equal(await f.invoke('page:floating-bar-click', 'translation-language', 'ja'), true)
    assert.equal(f.stored.translationTargetLanguage, 'ja')
    assert.equal(f.writes, 1)
    assert.equal(f.events.length, 1)
    assert.equal(f.events[0].channel, 'store:changed')
    assert.equal(f.events[0].value.translationTargetLanguage, 'ja')
    assert.deepEqual(f.actions, [])
    assert.equal(await f.invoke('page:floating-bar-click', 'translation-language', 'de'), false)
    assert.equal(await f.invoke('page:floating-bar-click', 'translation-language', 42), false)
    assert.equal(f.writes, 1)
  }],
  ['floating translation persistence failure does not broadcast a new saved preference', async () => {
    const f = fixture()
    f.saveFails = true
    await assert.rejects(() => f.invoke('page:floating-bar-click', 'translation-language', 'ja'), /disk unavailable/)
    assert.equal(f.stored.translationTargetLanguage, 'en')
    assert.equal(f.writes, 0)
    assert.deepEqual(f.events, [])
  }],
  ['provider management saves once, encrypts credentials and broadcasts without unrelated OS actions', async () => {
    const f = fixture()
    const profile = { id: 'provider', presetId: 'custom', name: 'Test provider', service: 'refinement', protocol: 'openai-chat', enabled: true, endpoint: 'http://127.0.0.1/v1', apiKey: 'test-secret', models: ['test-model'], appId: '', accessToken: '', resourceId: '', apiVersion: '' }
    const result = await f.invoke('providers:manage', { action: 'save', profile, activateModel: 'test-model' })
    assert.equal(result.refinement.providerId, 'provider')
    assert.equal(result.profiles[0].apiKey, 'test-secret')
    assert.equal(f.disk.settings.serviceProviders.profiles[0].apiKey, '')
    assert.equal(f.writes, 1)
    assert.equal(f.events.length, 1)
    assert.equal(f.events[0].channel, 'store:changed')
    assert.equal(f.events[0].value.serviceProviders.refinement.providerId, 'provider')
    assert.deepEqual(f.actions, [])
    f.saveFails = true
    await assert.rejects(() => f.invoke('providers:manage', { action: 'remove', id: 'provider' }), /disk unavailable/)
    assert.equal(f.writes, 1)
    assert.equal(f.events.length, 1)
    assert.equal(f.stored.serviceProviders.profiles[0].id, 'provider')
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
