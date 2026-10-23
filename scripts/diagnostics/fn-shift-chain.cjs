// Real TS modules, isolated peripherals: no microphone, user data, network, or pasteboard.
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path')
const ts = require('typescript'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..')
const flush = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const broadcasts = [], inserted = [], rows = [], refinementStates = []
let forwardBroadcast = () => {}
const logger = { debug(){}, info(){}, warn(){}, error(){} }
function load(file, overrides = {}, globals = {}) {
  const exports = {}
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(source, { exports, require: id => id in overrides ? overrides[id] : id in mocks ? mocks[id] : require(id), process: { env: {} }, console, Buffer, Float32Array, AbortController, URL, structuredClone, queueMicrotask, setTimeout, clearTimeout, setInterval, clearInterval, ...globals }, { filename: file })
  return exports
}
const mocks = { '../lib/logger': { createLogger: () => logger } }
const shared = load('src/shared/constants.ts')
mocks['./constants'] = shared
mocks['./providers'] = load('src/shared/providers.ts')
const sharedProviders = mocks['./providers']
mocks['../../shared/recordingFeedback'] = load('src/shared/recordingFeedback.ts', { './constants': shared, './providers': sharedProviders })
mocks['./settingsControls'] = load('src/shared/settingsControls.ts')
mocks['../../shared/settingsControls'] = mocks['./settingsControls']
const { DEFAULT_SETTINGS, mergeSettings } = load('src/shared/settings.ts')
const config = structuredClone(DEFAULT_SETTINGS)
config.historyEnabled = false
const readyProviders = {
  profiles: ['transcription', 'refinement'].map(service => ({ id: service, presetId: '', name: service, enabled: true, service,
    protocol: service === 'transcription' ? 'openai-transcription' : 'openai-chat', endpoint: 'https://fixture.example/v1',
    apiKey: 'fixture-key', models: ['fixture-model'], appId: '', accessToken: '', resourceId: '', apiVersion: '' })),
  transcription: { providerId: 'transcription', model: 'fixture-model' }, refinement: { providerId: 'refinement', model: 'fixture-model' }
}
let transcribe = async () => ({ result: { text: 'hello' }, ogg: Buffer.alloc(0) })
Object.assign(mocks, {
  'node:fs/promises': { readFile: async () => Buffer.from('fixture-audio') },
  '../lib/paths': { paths: {} }, '../../shared/constants': shared,
  '../windows': { broadcast: (...args) => { broadcasts.push(args); forwardBroadcast(...args) }, windows: { floatingBar: { createWindow(){}, show(){} } }, interactiveCardWindow: { setPayload(){}, createWindow(){}, show(){} } },
  '../../shared/ipc': { IPC: {} }, './history': { upsertHistory: row => rows.push(row), getHistory: id => ({ id, mode: 'voice_transcript', audioLocalPath: '/fixture.ogg', duration: 1200 }) },
  './dictionary': { listDictionary: () => [] }, './voiceActions': { runVoiceAction: async () => 'answer' },
  './insertion': { insertText: async text => { inserted.push(text); return { ok: true } } },
  './transcription': { transcribe: (...args) => transcribe(...args) },
  './providers': { createProviders: (_legacy, state) => { refinementStates.push(state); return { transcription: { transcribe: async (...args) => (await transcribe(...args)).result }, refinement: { refine: async ({ transcript }) => ({ text: transcript }) } } } },
  '../lib/settings': { settings: { get: () => config } }, './contextCapture': { captureAudioContext: async () => null }
})
const { RecordingMachine } = load('src/main/services/recordingMachine.ts')
async function test(name, fn) { config.serviceProviders = structuredClone(readyProviders); await fn(); console.log(`PASS ${name}`) }
async function start(machine) { await machine.start(); const id = machine.getState().context.sessionId; machine.markStreaming(id); machine.pushPcm(new Float32Array([.25]), id); return id }
function floatingActions(machine) {
  const handlers = new Map()
  load('src/main/ipc/windows.ts', {
    electron: {}, '../services/recordingMachine': { recordingMachine: machine },
    '../services/settingsEffects': { patchSettings: async partial => Object.assign(config, partial) },
    '../lib/native': { util: {} }
  }).registerWindowHandlers((channel, handler) => handlers.set(channel, handler))
  return action => handlers.get('page:floating-bar-click')({}, action)
}
function nativeKeys(machine) {
  let longPress = null
  const keys = load('src/main/services/hotkeys.ts', { './recordingMachine': { recordingMachine: machine } }, {
    setTimeout(callback, delay) { assert.equal(delay, 600); longPress = callback; return callback },
    clearTimeout(callback) { if (longPress === callback) longPress = null }
  })
  return { ...keys,
    tap(combination = 'Fn') { keys.handleKeyEvent({ combination, pressed: true }); keys.handleKeyEvent({ combination, pressed: false }) },
    hold() { assert.ok(longPress, 'a physical toggle press arms the hold timer'); const callback = longPress; longPress = null; callback() }
  }
}
async function recorderChain(machine) {
  const handlers = new Map(), listeners = new Map(), exposed = {}, deliveries = [], tracks = [], contexts = [], processors = []
  const event = { sender: { id: 7 } }
  const register = (channel, handler) => handlers.set(channel, handler)
  load('src/main/ipc/windows.ts', {
    electron: {}, '../services/recordingMachine': { recordingMachine: machine },
    '../services/settingsEffects': { patchSettings: async partial => Object.assign(config, partial) }, '../lib/native': { util: {} }
  }).registerWindowHandlers(register)
  load('src/main/ipc/misc.ts', {
    electron: { webContents: { fromId: ownerId => ({ send: (channel, result) => deliveries.push({ ownerId, channel, result }) }) } },
    '../services/recordingMachine': { recordingMachine: machine },
    '../../shared/featureTour': load('src/shared/featureTour.ts'),
    '../services/hotkeys': { shortcutBindings: () => [] }, '../services/shortcutRegistration': {},
    '../services/insertion': mocks['./insertion'],
    '../services/dictionary': { listDictionary: () => [], addWord(){}, updateWord(){}, removeWord(){} },
    '../lib/native': { keyboard: {}, util: {}, input: {}, context: {} }
  }).registerMiscHandlers(register)
  load('src/preload/index.ts', {
    '../shared/ipc': { IPC: {} },
    electron: {
      contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value } },
      ipcRenderer: {
        on: (channel, callback) => { const set = listeners.get(channel) ?? new Set(); set.add(callback); listeners.set(channel, set) },
        removeListener: (channel, callback) => listeners.get(channel)?.delete(callback),
        invoke: async (channel, ...args) => {
          const handler = handlers.get(channel)
          assert.ok(handler, 'real IPC handler registered: ' + channel)
          return handler(event, ...args)
        }
      }
    }
  })
  class AudioContext {
    sampleRate = 48000
    audioWorklet = { addModule: async () => { throw new Error('Offline ScriptProcessor adapter') } }
    constructor() { this.closed = false; contexts.push(this) }
    createMediaStreamSource() { return { connect(){}, disconnect(){} } }
    createAnalyser() { return { fftSize: 2048, getByteTimeDomainData: samples => samples.fill(128) } }
    createScriptProcessor() { const node = { connect(){}, disconnect(){}, onaudioprocess: null }; processors.push(node); return node }
    async resume() {}
    async close() { this.closed = true }
  }
  let openGate = null
  const { startRecorder } = load('src/renderer/floating-bar/audio.ts', {}, {
    AudioContext, Uint8Array, requestAnimationFrame: callback => setTimeout(callback, 16), cancelAnimationFrame: clearTimeout,
    navigator: { mediaDevices: { getUserMedia: async () => {
      if (openGate) await openGate.promise
      const track = { stopped: 0, stop() { this.stopped++ } }; tracks.push(track)
      return { getTracks: () => [track] }
    } } }
  })
  const { RecorderSessionController } = load('src/renderer/floating-bar/sessionController.ts')
  const controller = new RecorderSessionController({
    settings: async () => ({ muteWhileDictating: false }), isMuted: async () => false, mute: async () => {}, unmute: async () => {},
    status: (phase, payload) => exposed.sayrel.recording.status(phase, payload), onRecorder(){}, start: startRecorder
  })
  const off = exposed.sayrel.on('recording-machine:state', state => controller.sync(state))
  forwardBroadcast = (channel, ...args) => listeners.get(channel)?.forEach(listener => listener({}, ...args))
  const action = action => exposed.sayrel.page.floatingBarClick(action)
  return {
    action, deliveries, tracks, contexts,
    pauseOpen() { openGate = deferred(); return () => { const gate = openGate; openGate = null; gate.resolve() } },
    feed(value = .25) { processors.at(-1).onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(2048).fill(value) } }) },
    async settle(phase) { for (let i = 0; i < 100; i++) { if (machine.getState().phase === phase) return; await flush() } assert.equal(machine.getState().phase, phase) },
    async dispose() { machine.cancel(); off(); forwardBroadcast = () => {}; await controller.dispose() }
  }
}
;(async () => {
  await test('native setup rejection stays hands-free false after physical release', async () => {
    const m = new RecordingMachine(), states = [], starts = []
    const keys = load('src/main/services/hotkeys.ts', { './recordingMachine': { recordingMachine: m } })
    m.on('state', state => states.push(state)); m.on('start', event => starts.push(event))
    config.serviceProviders = { profiles: [], transcription: null, refinement: null }
    keys.handleKeyEvent({ combination: 'Fn', pressed: true })
    keys.handleKeyEvent({ combination: 'Fn', pressed: false })
    assert.equal(m.getState().phase, 'error')
    assert.equal(m.getState().context.sessionId, null)
    assert.equal(m.getState().context.handsFree, false)
    assert.equal(starts.length, 0)
    assert.ok(states.every(state => !state.context.handsFree))
    keys.resetHotkeyState(); m.cancel()
  })
  await test('a rejected native gesture cannot restart after another entry completes a recording', async () => {
    const m = new RecordingMachine(), starts = []
    const keys = load('src/main/services/hotkeys.ts', { './recordingMachine': { recordingMachine: m } })
    m.on('start', event => starts.push(event))
    m.setPracticeTarget(7, { id: 'question', kind: 'question', mode: 'ask_anything', selectedText: '' })
    keys.handleKeyEvent({ combination: 'Fn', pressed: true })
    assert.equal(m.getState().phase, 'idle')
    await m.startPractice(7)
    const id = m.getState().context.sessionId
    m.markStreaming(id); m.pushPcm(new Float32Array([.25]), id)
    const finished = m.finishPractice(7); m.markStopped(id); await finished
    keys.handleKeyEvent({ combination: 'Fn+Space', pressed: true, replacedCombination: 'Fn' })
    const phase = m.getState().phase
    keys.resetHotkeyState(); m.cancel()
    assert.equal(phase, 'idle')
    assert.equal(starts.length, 1)
  })
  await test('old native releases, hold timers and upgrades cannot affect a new floating capture', async () => {
    for (const action of ['release', 'cancelled-release', 'long-press', 'upgrade']) {
      const m = new RecordingMachine(), keys = nativeKeys(m), floating = floatingActions(m)
      config.shortcut.style = action.includes('release') ? 'hold' : 'toggle'
      try {
        keys.handleKeyEvent({ combination: 'Fn', pressed: true })
        await floating('cancel'); await floating('start')
        const id = m.getState().context.sessionId
        if (action === 'long-press') keys.hold()
        else if (action === 'upgrade') keys.handleKeyEvent({ combination: 'Fn+Shift', pressed: true, replacedCombination: 'Fn' })
        else keys.handleKeyEvent({ combination: 'Fn', pressed: false, cancelled: action === 'cancelled-release' })
        assert.equal(m.getState().context.sessionId, id, action)
        assert.equal(m.getState().context.mode, 'voice_transcript', action)
        assert.equal(m.getState().context.handsFree, true, action)
        assert.equal(m.getState().phase, 'starting', action)
      } finally { keys.resetHotkeyState(); m.cancel(); config.shortcut.style = 'toggle' }
    }
  })
  await test('native presses rejected by disabled and practice scope never publish capture or hands-free', async () => {
    for (const restriction of ['disabled', 'blocked', 'mismatched']) {
      const m = new RecordingMachine(), keys = nativeKeys(m), states = [], starts = []
      m.on('state', state => states.push(state)); m.on('start', event => starts.push(event))
      if (restriction === 'disabled') m.setDisabled(true)
      if (restriction === 'blocked') m.blockPractice(7)
      if (restriction === 'mismatched') m.setPracticeTarget(7, { id: 'question', kind: 'question', mode: 'ask_anything', selectedText: '' })
      keys.handleKeyEvent({ combination: 'Fn', pressed: true })
      keys.hold()
      keys.handleKeyEvent({ combination: 'Fn', pressed: false })
      assert.equal(m.getState().phase, 'idle', restriction)
      assert.equal(m.getState().context.sessionId, null, restriction)
      assert.equal(starts.length, 0, restriction)
      assert.ok(states.every(state => !state.context.handsFree), restriction)
      keys.resetHotkeyState(); m.cancel()
    }
  })
  await test('release of a native stop gesture cannot finish a later recording', async () => {
    const m = new RecordingMachine(), keys = nativeKeys(m), floating = floatingActions(m)
    try {
      keys.handleKeyEvent({ combination: 'Fn', pressed: true })
      keys.handleKeyEvent({ combination: 'Fn', pressed: false })
      const first = m.getState().context.sessionId
      m.markStreaming(first); m.pushPcm(new Float32Array([.25]), first)
      config.shortcut.style = 'hold'
      keys.handleKeyEvent({ combination: 'Fn', pressed: true })
      const finished = m.finish(); m.markStopped(first); await finished
      await floating('start')
      const next = m.getState().context.sessionId
      keys.handleKeyEvent({ combination: 'Fn', pressed: false })
      assert.equal(m.getState().phase, 'starting')
      assert.equal(m.getState().context.sessionId, next)
      assert.equal(m.getState().context.handsFree, true)
    } finally { keys.resetHotkeyState(); m.cancel(); config.shortcut.style = 'toggle' }
  })
  await test('intro and completion pages block microphone shortcuts without disabling later normal recordings', async () => {
    const m=new RecordingMachine()
    m.blockPractice(7)
    await m.start()
    assert.equal(m.getState().phase,'idle')
    assert.throws(()=>m.blockPractice(8),/another window/)
    await assert.rejects(m.retryHistory('saved-id'),/Exit the practice/)
    m.setPracticeTarget(8,null);await m.start();assert.equal(m.getState().phase,'idle')
    m.setPracticeTarget(7,null);await m.start();assert.equal(m.getState().phase,'starting');m.cancel()
  })
  await test('practice dictation delivers only to its owner without pasting or writing history', async () => {
    const m = new RecordingMachine(), results = [], beforeInserted=inserted.length, beforeRows=rows.length
    m.on('practice-result', result => results.push(result))
    m.setPracticeTarget(7,{id:'practice-1',kind:'dictation',mode:'voice_transcript'})
    const id=await start(m), finished=m.finish()
    m.markStopped(id); await finished
    assert.equal(inserted.length,beforeInserted)
    assert.equal(rows.length,beforeRows)
    assert.equal(results.length,1)
    assert.equal(results[0].ownerId,7)
    assert.equal(results[0].targetId,'practice-1')
    assert.equal(results[0].text,'hello')
    m.setPracticeTarget(7,null)
  })
  await test('practice Fn+Space upgrade starts only the requested mode and snapshots selected text', async () => {
    const m = new RecordingMachine(), keys = load('src/main/services/hotkeys.ts', { './recordingMachine': { recordingMachine: m } })
    m.setPracticeTarget(7,{id:'rewrite',kind:'rewrite',mode:'ask_anything',selectedText:'selected passage'})
    keys.handleKeyEvent({combination:'Fn',pressed:true})
    assert.equal(m.getState().phase,'idle')
    keys.handleKeyEvent({combination:'Fn+Space',pressed:true,replacedCombination:'Fn'})
    assert.equal(m.getState().phase,'starting')
    let selectedText
    const previousTranscribe = transcribe
    transcribe = async options => { selectedText = options.context.focusedInput.selectedText; return previousTranscribe(options) }
    m.setPracticeTarget(8,null)
    assert.equal(m.getState().phase,'starting','another window cannot stop the practice')
    const id = m.getState().context.sessionId
    m.markStreaming(id); m.pushPcm(new Float32Array([.25]), id)
    const finished = m.finish(); m.markStopped(id); await finished
    assert.equal(selectedText, 'selected passage')
    transcribe = previousTranscribe
    m.setPracticeTarget(7,null)
    assert.equal(m.getState().phase,'idle')
    keys.resetHotkeyState()
  })
  await test('leaving a practice aborts its pending result and restores normal dictation', async () => {
    const gate=deferred(), m=new RecordingMachine(), results=[], beforeInserted=inserted.length
    m.on('practice-result', result=>results.push(result))
    m.setPracticeTarget(7,{id:'practice-2',kind:'dictation',mode:'voice_transcript'})
    transcribe=()=>gate.promise
    const id=await start(m), finished=m.finish();m.markStopped(id);await flush()
    m.setPracticeTarget(7,null)
    gate.resolve({result:{text:'late practice'},ogg:Buffer.alloc(0)})
    await finished
    assert.equal(results.length,0);assert.equal(inserted.length,beforeInserted)
    transcribe=async()=>({result:{text:'normal again'},ogg:Buffer.alloc(0)})
    const next=await start(m), normal=m.finish();m.markStopped(next);await normal
    assert.equal(inserted.at(-1),'normal again')
    transcribe=async()=>({result:{text:'hello'},ogg:Buffer.alloc(0)})
  })
  await test('missing provider opens a setup error before microphone capture', async () => {
    config.serviceProviders = { profiles: [], transcription: null, refinement: null }
    const machine = new RecordingMachine()
    let starts = 0
    machine.on('start', () => starts++)
    await machine.start('voice_transcript')
    const state = machine.getState()
    machine.cancel()
    assert.equal(state.phase, 'error')
    assert.equal(state.context.issue.kind, 'provider-setup')
    assert.equal(state.context.issue.service, 'transcription')
    assert.equal(state.context.sessionId, null)
    assert.equal(starts, 0, 'setup errors never open the microphone')
  })
  await test('translation and questions require a writing model before capture', async () => {
    config.serviceProviders.refinement = null
    for (const mode of ['translation', 'ask_anything']) {
      const machine = new RecordingMachine()
      await machine.start(mode)
      assert.equal(machine.getState().phase, 'error')
      assert.equal(machine.getState().context.issue.service, 'refinement')
      assert.equal(machine.getState().context.sessionId, null)
      machine.cancel()
    }
  })
  await test('configuring a provider lets the next shortcut start without restarting', async () => {
    config.serviceProviders = { profiles: [], transcription: null, refinement: null }
    const machine = new RecordingMachine()
    await machine.start('voice_transcript')
    assert.equal(machine.getState().phase, 'error')
    config.serviceProviders = structuredClone(readyProviders)
    await machine.start('voice_transcript')
    const state = machine.getState()
    machine.cancel()
    assert.equal(state.phase, 'starting')
    assert.equal(state.context.issue, null)
  })
  await test('upgrading Fn to translation without a writing model stops capture and keeps the setup alert', async () => {
    config.serviceProviders.refinement = null
    const machine = new RecordingMachine(), keys = nativeKeys(machine)
    keys.handleKeyEvent({ combination: 'Fn', pressed: true })
    keys.handleKeyEvent({ combination: 'Fn+Shift', pressed: true, replacedCombination: 'Fn' })
    keys.handleKeyEvent({ combination: 'Fn+Shift', pressed: false })
    const state = machine.getState()
    assert.equal(state.phase, 'error')
    assert.equal(state.context.mode, 'translation')
    assert.equal(state.context.issue.service, 'refinement')
    assert.equal(state.context.sessionId, null)
    assert.equal(state.context.handsFree, false)
    keys.resetHotkeyState(); machine.cancel()
  })
  await test('old defaults migrate Fn+Shift to translation and tap gestures', () => {
    const migrated = mergeSettings({ shortcut: { accelerator: 'Fn', style: 'hold', enabled: true }, commandShortcut: { accelerator: 'Fn+Shift', style: 'hold', enabled: true } })
    assert.equal(migrated.translationShortcut.accelerator, 'Fn+Shift')
    assert.equal(migrated.commandShortcut.enabled, false)
    assert.equal(migrated.shortcut.style, 'toggle')
  })
  await test('translation selection updates only an active capture and rejects unknown targets', async () => {
    config.translationTargetLanguages = ['en', 'ja']
    const machine = new RecordingMachine()
    await machine.start('translation')
    assert.equal(machine.selectTranslationLanguage('ja'), true)
    let targetLanguage
    const previousTranscribe = transcribe
    transcribe = async options => { targetLanguage = options.config.translationTargetLanguage; return previousTranscribe(options) }
    assert.equal(machine.selectTranslationLanguage('de'), false)
    const id = machine.getState().context.sessionId
    machine.markStreaming(id); machine.pushPcm(new Float32Array([.25]), id)
    const finishing = machine.dispatch({ type: 'FINISH' })
    assert.equal(machine.selectTranslationLanguage('en'), false)
    machine.markStopped(id); await finishing
    assert.equal(targetLanguage, 'ja')
    transcribe = previousTranscribe
    config.translationTargetLanguages = ['en']
  })
  await test('finishing drains tail before processing and rejects overlapping starts', async () => {
    const m = new RecordingMachine(), id = await start(m)
    let samples
    transcribe = async ({ pcm }) => { samples = [...pcm]; return { result: { text: 'tail' }, ogg: Buffer.alloc(0) } }
    const finished = m.finish()
    m.markStreaming(id)
    await m.start()
    assert.equal(m.getState().phase, 'finishing')
    assert.equal(m.getState().context.sessionId, id)
    assert.equal(samples, undefined)
    m.pushPcm(new Float32Array([.5]), id)
    m.markStopped(id)
    await finished
    assert.deepEqual(samples, [.25, .5])
    assert.equal(m.getState().phase, 'idle')
    assert.ok(broadcasts.some(([event, state]) => event === 'recording-machine:state' && state.phase === 'starting'))
  })
  await test('cancelled provider result cannot paste or overwrite a newer session', async () => {
    const gate = deferred(), m = new RecordingMachine(), before = inserted.length
    transcribe = () => gate.promise
    const id = await start(m), finished = m.finish()
    m.markStopped(id); await flush(); m.cancel()
    const next = await start(m)
    m.markStreaming(id); m.pushPcm(new Float32Array([9]), id); m.markStopped(id)
    gate.resolve({ result: { text: 'stale' }, ogg: Buffer.alloc(0) })
    await finished
    assert.equal(inserted.length, before)
    assert.equal(m.getState().context.sessionId, next)
    assert.equal(m.getState().phase, 'recording')
    m.cancel()
  })
  await test('retry reuses failed audio; explicit cancel discards it', async () => {
    const m = new RecordingMachine(), id = await start(m)
    const failurePhases = []
    m.on('state', state => failurePhases.push(state.phase))
    transcribe = async () => { throw new Error('offline') }
    const finished = m.finish(); m.markStopped(id); await finished
    assert.equal(m.getState().phase, 'error')
    assert.deepEqual(failurePhases, ['finishing','error'], 'failure never briefly enters idle and hides the recorder')
    assert.equal(m.getState().context.issue.canRetry, true)
    let samples
    transcribe = async ({ pcm }) => { samples = [...pcm]; return { result: { text: 'retried' }, ogg: Buffer.alloc(0) } }
    await m.retry()
    assert.deepEqual(samples, [.25]); assert.equal(m.getState().phase, 'idle')
    const next = await start(m); transcribe = async () => { throw new Error('offline') }
    const again = m.finish(); m.markStopped(next); await again; m.cancel()
    await m.retry(); assert.equal(m.getState().phase, 'starting'); m.cancel()
  })
  await test('live transcription and retry retain the capture provider snapshot and use separate cancellation signals', async () => {
    const saved = structuredClone(config)
    const provider = { id: 'original', presetId: '', name: 'Original', enabled: true, service: 'transcription', protocol: 'openai-transcription', endpoint: 'https://original.example/v1', apiKey: 'original-key', models: ['original-model'], appId: '', accessToken: '', resourceId: '', apiVersion: '' }
    config.serviceProviders = { profiles: [provider], transcription: { providerId: provider.id, model: 'original-model' }, refinement: null }
    const originalState = structuredClone(config.serviceProviders)
    const m = new RecordingMachine(), id = await start(m)
    config.serviceProviders = { profiles: [], transcription: null, refinement: null }
    let firstSignal
    transcribe = async options => {
      assert.deepEqual(options.config.serviceProviders, originalState)
      assert.equal(options.signal.aborted, false)
      firstSignal = options.signal
      throw new Error('temporary transport failure')
    }
    const finished = m.finish(); m.markStopped(id); await finished
    assert.equal(m.getState().phase, 'error')
    assert.equal(firstSignal.aborted, true)
    transcribe = async options => {
      assert.deepEqual(options.config.serviceProviders, originalState)
      assert.notEqual(options.signal, firstSignal)
      assert.equal(options.signal.aborted, false)
      return { result: { text: 'snapshot retry' }, ogg: Buffer.alloc(0) }
    }
    await m.retry()
    assert.deepEqual(refinementStates.at(-1), originalState)
    assert.equal(m.getState().phase, 'idle')
    Object.assign(config, saved)
  })
  await test('production transcription uses supplied snapshot for live and historical audio without reloading settings', async () => {
    const snapshot = structuredClone(config), signal = new AbortController().signal, captured = []
    const { transcribe: run } = load('src/main/services/transcription.ts', {
      '../lib/workers': { workerThreads: { encodeOpus: async () => ({ ogg: Buffer.from('encoded-audio') }) } },
      '../lib/settings': { settings: { get() { throw new Error('must not read mutable global settings') } } },
      './providers': { createProviders: (legacy, state) => {
        assert.equal(legacy, snapshot.provider); assert.equal(state, snapshot.serviceProviders)
        return { transcription: { transcribe: async req => { captured.push(req); return { text: 'snapshot', provider: 'probe', detectedLanguage: null } } } }
      } }
    })
    const pcm = new Float32Array([.2, .4])
    await run({ pcm, config: snapshot, signal, durationMs: 2, mode: 'voice_transcript' })
    assert.equal(captured[0].pcm, pcm); assert.equal(captured[0].signal, signal); assert.equal(captured[0].sampleRate, 16000)
    assert.equal(captured[0].audioBuffer.toString(), 'encoded-audio')
    await run({ audioPath: '/fixture.ogg', config: snapshot, signal, durationMs: 2, mode: 'voice_transcript' })
    assert.equal(captured[1].audioBuffer.toString(), 'fixture-audio'); assert.equal(captured[1].signal, signal)
  })
  await test('saved-history retry updates existing record without pasting; errors reach caller', async () => {
    const m = new RecordingMachine(), before = inserted.length
    transcribe = async () => ({ result: { text: 'saved audio' }, ogg: Buffer.alloc(0) })
    await m.retryHistory('saved-id')
    assert.equal(inserted.length, before)
    assert.equal(rows.at(-1).id, 'saved-id')
    assert.equal(rows.at(-1).status, shared.HISTORY_STATUS.COMPLETED)
    transcribe = async () => { throw new Error('saved retry failed') }
    await assert.rejects(m.retryHistory('saved-id'), /saved retry failed/)
    assert.equal(m.getState().phase, 'error')
    m.cancel()
  })
  await test('Fn chord upgrade starts once in translation/ask mode; second tap finishes', async () => {
    for (const [chord, mode] of [['Fn+Shift', 'translation'], ['Fn+Space', 'ask_anything']]) {
      const m = new RecordingMachine()
      const keys = load('src/main/services/hotkeys.ts', { './recordingMachine': { recordingMachine: m } })
      keys.handleKeyEvent({ combination: 'Fn', pressed: true })
      const id = m.getState().context.sessionId
      keys.handleKeyEvent({ combination: chord, pressed: true, replacedCombination: 'Fn' })
      assert.equal(m.getState().context.mode, mode); assert.equal(m.getState().context.sessionId, id)
      keys.handleKeyEvent({ combination: chord, pressed: false })
      assert.equal(m.getState().context.handsFree, true)
      keys.handleKeyEvent({ combination: chord, pressed: true })
      assert.equal(m.getState().phase, 'finishing')
      keys.handleKeyEvent({ combination: chord, pressed: false })
      m.cancel(); keys.resetHotkeyState()
    }
  })
  await test('long press cancels capture, release clears hint, hold binding still works', async () => {
    const m = new RecordingMachine(), keys = nativeKeys(m)
    keys.handleKeyEvent({ combination: 'Fn', pressed: true })
    keys.hold()
    assert.equal(m.getState().phase, 'long_pressing')
    keys.handleKeyEvent({ combination: 'Fn', pressed: false }); assert.equal(m.getState().phase, 'idle')
    config.shortcut.style = 'hold'
    keys.handleKeyEvent({ combination: 'Fn', pressed: true })
    keys.handleKeyEvent({ combination: 'Fn', pressed: false }); assert.equal(m.getState().phase, 'finishing')
    m.cancel(); keys.resetHotkeyState(); config.shortcut.style = 'toggle'
  })
  await test('main → real preload callback → recorder → chunks → stopped → result', async () => {
    const m = new RecordingMachine(), listeners = new Map(), exposed = {}
    const { RecorderSessionController } = load('src/renderer/floating-bar/sessionController.ts')
    load('src/preload/index.ts', {
      '../shared/ipc': { IPC: {} },
      electron: {
        contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value } },
        ipcRenderer: {
          on: (channel, callback) => listeners.set(channel, callback),
          removeListener: channel => listeners.delete(channel),
          invoke: async (_channel, phase, payload) => {
            if (phase === 'started') m.markStreaming(payload.sessionId)
            if (phase === 'chunk') m.pushPcm(new Float32Array(payload.pcm), payload.sessionId)
            if (phase === 'stopped') m.markStopped(payload.sessionId)
          }
        }
      }
    })
    let samples, stopped = 0
    const controller = new RecorderSessionController({
      settings: async () => ({ muteWhileDictating: false }),
      isMuted: async () => false, mute: async () => {}, unmute: async () => {},
      status: (phase, payload) => exposed.sayrel.invoke('recording-machine:status', phase, payload),
      onRecorder() {},
      start: async options => ({ stop: async () => { stopped++; options.onChunk(new Float32Array([.25, .5, .75])) } })
    })
    const off = exposed.sayrel.on('recording-machine:state', state => controller.sync(state))
    forwardBroadcast = (channel, ...args) => listeners.get(channel)?.({ sender: 'main' }, ...args)
    transcribe = async ({ pcm }) => { samples = [...pcm]; return { result: { text: 'integrated' }, ogg: Buffer.alloc(0) } }
    await m.start(); await flush()
    assert.equal(m.getState().phase, 'recording')
    await m.finish()
    assert.equal(stopped, 1); assert.deepEqual(samples, [.25, .5, .75]); assert.equal(m.getState().phase, 'idle')
    off(); forwardBroadcast = () => {}; await controller.dispose()
  })
  await test('native, floating and fallback run real IPC/preload/controller/capture, drain the tail and deliver once', async () => {
    for (const entry of ['native', 'floating', 'fallback']) {
      const m = new RecordingMachine(), chain = await recorderChain(m), results = [], before = inserted.length
      const keys = nativeKeys(m)
      m.on('result', result => results.push(result))
      let samples
      transcribe = async ({ pcm }) => { samples = [...pcm]; return { result: { text: entry + ' tail' }, ogg: Buffer.alloc(0) } }
      if (entry === 'floating') await chain.action('start')
      else if (entry === 'fallback') keys.handleFallbackShortcut('Fn')
      else keys.tap()
      await chain.settle('recording')
      assert.equal(m.getState().context.handsFree, true)
      chain.feed()
      if (entry === 'floating') await chain.action('finish')
      else if (entry === 'fallback') keys.handleFallbackShortcut('Fn+Space')
      else keys.tap()
      await chain.settle('idle')
      assert.equal(samples.length, 682, 'capture drains the partial 48k to 16k resampling block')
      assert.ok(samples.every(value => value === .25))
      assert.equal(results.length, 1); assert.equal(inserted.length, before + 1); assert.equal(inserted.at(-1), entry + ' tail')
      assert.ok(chain.tracks.every(track => track.stopped === 1)); assert.ok(chain.contexts.every(context => context.closed))
      keys.resetHotkeyState(); await chain.dispose()
    }
  })
  await test('native Fn upgrades during device open and recording process only the final mode in the same session', async () => {
    for (const phase of ['starting', 'recording']) for (const [chord, mode] of [['Fn+Shift', 'translation'], ['Fn+Space', 'ask_anything']]) {
      const m = new RecordingMachine(), chain = await recorderChain(m), keys = nativeKeys(m), starts = [], results = [], processedModes = []
      m.on('start', event => starts.push(event)); m.on('result', result => results.push(result))
      transcribe = async options => { processedModes.push(options.mode); return { result: { text: 'mode upgrade' }, ogg: Buffer.alloc(0) } }
      let release
      try {
        if (phase === 'starting') release = chain.pauseOpen()
        keys.handleKeyEvent({ combination: 'Fn', pressed: true })
        if (phase === 'recording') await chain.settle('recording')
        const id = m.getState().context.sessionId
        keys.handleKeyEvent({ combination: chord, pressed: true, replacedCombination: 'Fn' })
        keys.handleKeyEvent({ combination: chord, pressed: false })
        assert.equal(m.getState().context.sessionId, id)
        assert.equal(m.getState().context.mode, mode)
        assert.equal(starts.length, 1); assert.equal(processedModes.length, 0)
        release?.(); release = null
        await chain.settle('recording'); chain.feed()
        keys.tap(chord)
        await chain.settle('idle')
        assert.deepEqual(processedModes, [mode]); assert.equal(results.length, 1)
        assert.equal(results[0].id, id); assert.equal(results[0].mode, mode)
        assert.equal(chain.tracks.length, 1)
      } finally { release?.(); keys.resetHotkeyState(); await chain.dispose() }
    }
  })
  await test('native hold release while opening the device finishes without late capture or results', async () => {
    const m = new RecordingMachine(), chain = await recorderChain(m), keys = nativeKeys(m), results = [], states = []
    m.on('result', result => results.push(result)); m.on('state', state => states.push(state))
    let release = chain.pauseOpen()
    config.shortcut.style = 'hold'
    try {
      keys.handleKeyEvent({ combination: 'Fn', pressed: true }); await flush()
      keys.handleKeyEvent({ combination: 'Fn', pressed: false })
      assert.equal(m.getState().phase, 'finishing')
      release(); release = null; await chain.settle('idle')
      assert.equal(results.length, 0); assert.ok(states.every(state => state.phase !== 'recording'))
      assert.ok(chain.tracks.every(track => track.stopped === 1)); assert.ok(chain.contexts.every(context => context.closed))
    } finally { release?.(); keys.resetHotkeyState(); await chain.dispose(); config.shortcut.style = 'toggle' }
  })
  await test('finishing during delayed device open accepts no late started event or result', async () => {
    const m = new RecordingMachine(), chain = await recorderChain(m), states = [], results = []
    m.on('state', state => states.push(state)); m.on('result', result => results.push(result))
    const release = chain.pauseOpen()
    await chain.action('start'); await flush()
    const finished = chain.action('finish')
    assert.equal(m.getState().phase, 'finishing')
    release(); await finished
    assert.equal(m.getState().phase, 'idle')
    assert.equal(results.length, 0); assert.ok(states.every(state => state.phase !== 'recording'))
    assert.ok(chain.tracks.every(track => track.stopped === 1)); assert.ok(chain.contexts.every(context => context.closed))
    await chain.dispose()
  })
  await test('native and floating retry reprocess the captured audio with the original provider snapshot', async () => {
    for (const entry of ['native', 'floating']) {
      config.serviceProviders = structuredClone(readyProviders)
      const m = new RecordingMachine(), chain = await recorderChain(m), keys = nativeKeys(m), snapshot = structuredClone(config.serviceProviders), before = inserted.length
      try {
        transcribe = async () => { throw new Error('temporary failure') }
        if (entry === 'floating') await chain.action('start')
        else keys.tap()
        await chain.settle('recording'); chain.feed()
        if (entry === 'floating') await chain.action('finish')
        else keys.tap()
        await chain.settle('error')
        const opened = chain.tracks.length
        config.serviceProviders = { profiles: [], transcription: null, refinement: null }
        transcribe = async options => {
          assert.deepEqual(options.config.serviceProviders, snapshot)
          assert.equal(options.pcm.length, 682)
          return { result: { text: 'retry snapshot' }, ogg: Buffer.alloc(0) }
        }
        await chain.action('retry')
        assert.equal(m.getState().phase, 'idle'); assert.equal(chain.tracks.length, opened)
        assert.equal(inserted.length, before + 1); assert.equal(inserted.at(-1), 'retry snapshot')
      } finally { keys.resetHotkeyState(); await chain.dispose() }
    }
  })
  await test('native and floating cancellation isolate pending results and deliver practice only to its owner', async () => {
    for (const entry of ['native', 'floating']) {
      const m = new RecordingMachine(), chain = await recorderChain(m), keys = nativeKeys(m), gate = deferred(), before = inserted.length, beforeRows = rows.length
      try {
        transcribe = () => gate.promise
        if (entry === 'floating') await chain.action('start'); else keys.tap()
        await chain.settle('recording'); chain.feed()
        let oldFinish
        if (entry === 'floating') oldFinish = chain.action('finish')
        else { keys.tap(); assert.equal(m.getState().phase, 'finishing'); oldFinish = m.finish() }
        await flush(); await chain.action('cancel')
        m.setPracticeTarget(7, { id: 'owned-dictation', kind: 'dictation', mode: 'voice_transcript' })
        if (entry === 'floating') await chain.action('start'); else keys.tap()
        await chain.settle('recording')
        const id = m.getState().context.sessionId
        gate.resolve({ result: { text: 'stale result' }, ogg: Buffer.alloc(0) }); await oldFinish
        assert.equal(m.getState().context.sessionId, id); assert.equal(inserted.length, before); assert.equal(chain.deliveries.length, 0)
        transcribe = async () => ({ result: { text: 'owned practice' }, ogg: Buffer.alloc(0) })
        chain.feed()
        if (entry === 'floating') await chain.action('finish'); else keys.tap()
        await chain.settle('idle')
        assert.equal(inserted.length, before); assert.equal(rows.length, beforeRows)
        assert.equal(chain.deliveries.length, 1); assert.equal(chain.deliveries[0].ownerId, 7)
        assert.equal(chain.deliveries[0].channel, 'feature-tour:result'); assert.equal(chain.deliveries[0].result.targetId, 'owned-dictation')
        assert.equal(chain.deliveries[0].result.text, 'owned practice')
      } finally { gate.resolve({ result: { text: 'cleanup' }, ogg: Buffer.alloc(0) }); keys.resetHotkeyState(); await chain.dispose() }
    }
  })
  await test('floating start rejected by configuration cannot publish hands-free or capture', async () => {
    const m = new RecordingMachine(), action = floatingActions(m), states = [], starts = []
    m.on('state', state => states.push(state)); m.on('start', event => starts.push(event))
    config.serviceProviders = { profiles: [], transcription: null, refinement: null }
    await action('start')
    assert.equal(m.getState().phase, 'error')
    assert.equal(m.getState().context.sessionId, null)
    assert.equal(m.getState().context.handsFree, false)
    assert.ok(states.every(state => !state.context.handsFree))
    assert.equal(starts.length, 0)
    await action('cancel')
  })
  await test('floating retry without retained audio respects a rejected start', async () => {
    const m = new RecordingMachine(), action = floatingActions(m), starts = []
    m.on('start', event => starts.push(event))
    config.serviceProviders = { profiles: [], transcription: null, refinement: null }
    await action('retry')
    assert.equal(m.getState().phase, 'error')
    assert.equal(m.getState().context.sessionId, null)
    assert.equal(m.getState().context.handsFree, false)
    assert.equal(starts.length, 0)
    await action('cancel')
  })
  await test('floating and fallback respect disabled, blocked and mismatched practice starts', async () => {
    for (const restriction of ['disabled', 'blocked', 'mismatched']) {
      const m = new RecordingMachine(), action = floatingActions(m), starts = []
      const keys = load('src/main/services/hotkeys.ts', { './recordingMachine': { recordingMachine: m } })
      m.on('start', event => starts.push(event))
      if (restriction === 'disabled') m.setDisabled(true)
      if (restriction === 'blocked') m.blockPractice(7)
      if (restriction === 'mismatched') m.setPracticeTarget(7, { id: 'question', kind: 'question', mode: 'ask_anything', selectedText: '' })
      await action('start'); await action('retry'); keys.handleFallbackShortcut('Fn'); await flush()
      assert.equal(m.getState().phase, 'idle', restriction)
      assert.equal(m.getState().context.sessionId, null, restriction)
      assert.equal(m.getState().context.handsFree, false, restriction)
      assert.equal(starts.length, 0, restriction)
      m.cancel()
    }
  })
  await test('duplicate floating start cannot convert a held capture or restart finishing', async () => {
    const m = new RecordingMachine(), action = floatingActions(m), starts = []
    const keys = load('src/main/services/hotkeys.ts', { './recordingMachine': { recordingMachine: m } })
    m.on('start', event => starts.push(event))
    await m.start('translation')
    const id = m.getState().context.sessionId
    await action('start'); await action('retry')
    assert.equal(m.getState().context.handsFree, false)
    assert.equal(m.getState().context.mode, 'translation')
    const finish = action('finish'), repeated = action('finish')
    await action('start'); await action('retry'); keys.handleFallbackShortcut('Fn'); await flush()
    assert.equal(m.getState().phase, 'finishing')
    assert.equal(m.getState().context.sessionId, id)
    assert.equal(m.getState().context.handsFree, false)
    assert.equal(starts.length, 1)
    m.markStopped(id); await Promise.all([finish, repeated])
    assert.equal(m.getState().phase, 'idle')
    await action('cancel'); await action('cancel'); await action('finish')
    assert.equal(m.getState().phase, 'idle')
  })
  await test('floating and fallback cannot restart or end the native long-press hint', async () => {
    const m = new RecordingMachine(), action = floatingActions(m)
    const keys = nativeKeys(m)
    keys.handleKeyEvent({ combination: 'Fn', pressed: true }); keys.hold()
    await action('start'); await action('retry'); keys.handleFallbackShortcut('Fn'); await flush()
    assert.equal(m.getState().phase, 'long_pressing')
    assert.equal(m.getState().context.sessionId, null)
    assert.equal(m.getState().context.handsFree, false)
    keys.handleKeyEvent({ combination: 'Fn', pressed: false }); keys.resetHotkeyState(); m.cancel()
  })
  await test('accepted floating start publishes hands-free atomically and repeats safely', async () => {
    const m = new RecordingMachine(), action = floatingActions(m), states = [], starts = []
    m.on('state', state => states.push(state)); m.on('start', event => starts.push(event))
    await action('start'); await action('start')
    assert.equal(m.getState().phase, 'starting')
    assert.equal(starts.length, 1)
    assert.ok(states.every(state => state.phase === 'starting' && state.context.handsFree))
    await action('cancel')
    assert.equal(m.getState().context.sessionId, null)
    assert.equal(m.getState().context.handsFree, false)
  })
  await test('fallback setup rejection never publishes an active session or hands-free state', async () => {
    const m = new RecordingMachine(), states = [], starts = []
    const keys = load('src/main/services/hotkeys.ts', { './recordingMachine': { recordingMachine: m } })
    m.on('state', state => states.push(state)); m.on('start', event => starts.push(event))
    config.serviceProviders = { profiles: [], transcription: null, refinement: null }
    keys.handleFallbackShortcut('Fn+Space'); await flush()
    assert.equal(m.getState().phase, 'error')
    assert.equal(m.getState().context.sessionId, null)
    assert.equal(m.getState().context.handsFree, false)
    assert.equal(starts.length, 0)
    assert.ok(states.every(state => state.context.handsFree === false))
    m.cancel()
  })
  await test('fallback toggle finishes even while microphone is starting', async () => {
    const m = new RecordingMachine(), keys = load('src/main/services/hotkeys.ts', { './recordingMachine': { recordingMachine: m } })
    keys.handleFallbackShortcut('Fn+Space'); assert.equal(m.getState().context.mode, 'ask_anything')
    keys.handleFallbackShortcut('Fn+Space'); assert.equal(m.getState().phase, 'finishing'); m.cancel()
  })
})().catch(error => { console.error(error); process.exitCode = 1 })
