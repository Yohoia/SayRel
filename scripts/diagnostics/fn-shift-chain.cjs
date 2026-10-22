// Real TS modules, isolated peripherals: no microphone, user data, network, or pasteboard.
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path')
const ts = require('typescript'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..')
const flush = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const broadcasts = [], inserted = [], rows = [], refinementStates = []
let forwardBroadcast = () => {}
const logger = { debug(){}, info(){}, warn(){}, error(){} }
function load(file, overrides = {}) {
  const exports = {}
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(source, { exports, require: id => id in overrides ? overrides[id] : id in mocks ? mocks[id] : require(id), process: { env: {} }, console, Buffer, Float32Array, AbortController, URL, structuredClone, queueMicrotask, setTimeout, clearTimeout, setInterval, clearInterval }, { filename: file })
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
;(async () => {
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
    assert.equal((await m.session.context).focusedInput.selectedText,'selected passage')
    m.setPracticeTarget(8,null)
    assert.equal(m.getState().phase,'starting','another window cannot stop the practice')
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
    const machine = new RecordingMachine()
    await machine.start('voice_transcript')
    machine.switchMode('translation')
    const state = machine.getState()
    assert.equal(state.phase, 'error')
    assert.equal(state.context.mode, 'translation')
    assert.equal(state.context.issue.service, 'refinement')
    assert.equal(state.context.sessionId, null)
    assert.equal(machine.session, null)
    machine.cancel()
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
    assert.equal(machine.session.config.translationTargetLanguage, 'ja')
    assert.equal(machine.selectTranslationLanguage('de'), false)
    const finishing = machine.dispatch({ type: 'FINISH' })
    assert.equal(machine.selectTranslationLanguage('en'), false)
    await machine.dispatch({ type: 'CANCEL' }); await finishing
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
    const m = new RecordingMachine(), keys = load('src/main/services/hotkeys.ts', { './recordingMachine': { recordingMachine: m } })
    keys.handleKeyEvent({ combination: 'Fn', pressed: true })
    await new Promise(resolve => setTimeout(resolve, 640))
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
  await test('fallback toggle finishes even while microphone is starting', async () => {
    const m = new RecordingMachine(), keys = load('src/main/services/hotkeys.ts', { './recordingMachine': { recordingMachine: m } })
    keys.handleFallbackShortcut('Fn+Space'); assert.equal(m.getState().context.mode, 'ask_anything')
    keys.handleFallbackShortcut('Fn+Space'); assert.equal(m.getState().phase, 'finishing'); m.cancel()
  })
})().catch(error => { console.error(error); process.exitCode = 1 })
