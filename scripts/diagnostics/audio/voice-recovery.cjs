// Real recording, transcription and history modules; only peripheral boundaries are isolated.
// Run with ELECTRON_RUN_AS_NODE=1 electron scripts/diagnostics/audio/voice-recovery.cjs.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const ts = require('typescript')
const Database = require('better-sqlite3')
const { drizzle } = require('drizzle-orm/better-sqlite3')
const root = path.resolve(__dirname, '../../..')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sayrel-voice-recovery-'))
const modules = new Map(), overrides = new Map()
const logger = { debug() {}, info() {}, warn() {}, error() {} }
const flush = () => new Promise(resolve => setImmediate(resolve))
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function sourceFile(file) {
  const candidates = [file, `${file}.ts`, `${file}.tsx`, path.join(file, 'index.ts')]
  const result = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
  if (!result) throw new Error(`No module at ${file}`)
  return result
}
function replace(file, exports) { overrides.set(path.join(root, file), exports) }
function load(file) {
  const absolute = sourceFile(path.isAbsolute(file) ? file : path.join(root, file))
  if (overrides.has(absolute)) return overrides.get(absolute)
  if (modules.has(absolute)) return modules.get(absolute)
  const exports = {}
  modules.set(absolute, exports)
  const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText
  new Function('require', 'exports', code)(name => {
    if (name === 'node:fs/promises') return {
      ...fs.promises,
      async writeFile(file, bytes, options) {
        await fs.promises.writeFile(file, bytes, options)
        writes.push(file)
        if (writeHook) await writeHook(file)
      }
    }
    return name.startsWith('.') ? load(path.resolve(path.dirname(absolute), name)) : require(name)
  }, exports)
  return exports
}

let config, writeHook = null, transcribeImpl, refineImpl, capturedContext = null, liveFactory = null
const writes = [], insertions = [], cards = [], broadcasts = [], providerConfigs = []
let asrCalls = 0, refinementCalls = 0, actionCalls = 0, learningCalls = 0, encoded = 0, insertionResult
replace('src/main/lib/logger.ts', { createLogger: () => logger })
replace('src/main/lib/paths.ts', { paths: { recordings: temporary } })
replace('src/main/lib/settings.ts', { settings: { get: () => config } })
replace('src/main/lib/workers.ts', { workerThreads: { async encodeOpus() { encoded++; return { ogg: Buffer.from('offline-encoded-audio') } } } })
replace('src/main/windows/index.ts', {
  broadcast: (...args) => broadcasts.push(args), windows: { floatingBar: { createWindow() {}, show() {} } },
  interactiveCardWindow: { setPayload: payload => cards.push(payload), createWindow() {}, show() {} }
})
replace('src/main/services/dictionary.ts', { listDictionary: () => [] })
replace('src/main/services/contextCapture.ts', { captureAudioContext: async () => capturedContext })
replace('src/main/services/insertion.ts', { insertText: async (text, options) => {
  assert.equal(options.isCancelled(), false)
  insertions.push(text)
  return insertionResult
} })
replace('src/main/services/voiceActions.ts', { runVoiceAction: async () => { actionCalls++; return 'offline action' } })
replace('src/main/services/dictionaryLearning.ts', {
  captureLearningSnapshot: () => { learningCalls++; return {} },
  trackInsertedDictation: () => { learningCalls++ }, stopDictionaryTracking() {}
})
replace('src/main/services/providers/realtime.ts', {
  supportsLiveTranscription: profile => profile.protocol === 'openai-realtime',
  startLiveTranscription: (...args) => liveFactory(...args)
})
replace('src/main/services/providers/index.ts', { createProviders: (_legacy, state) => {
  providerConfigs.push(structuredClone(state))
  return {
    transcription: { transcribe: async request => { asrCalls++; return transcribeImpl(request) } },
    refinement: { refine: async request => { refinementCalls++; return refineImpl(request) } }
  }
} })
const schema = load('src/main/db/schema.ts')
const raw = new Database(':memory:')
for (const file of fs.readdirSync(path.join(root, 'resources/db')).filter(file => file.endsWith('.sql')).sort()) {
  raw.exec(fs.readFileSync(path.join(root, 'resources/db', file), 'utf8'))
}
const db = drizzle(raw, { schema })
replace('src/main/db/index.ts', { getDb: () => db, getRawDb: () => raw, schema })
const history = load('src/main/services/history.ts')
const { DEFAULT_SETTINGS } = load('src/shared/settings.ts')
const { HISTORY_STATUS } = load('src/shared/constants.ts')
const { readVoiceMetadata } = load('src/shared/refinement.ts')
const { RecordingMachine } = load('src/main/services/recordingMachine.ts')
const readyProviders = {
  profiles: ['transcription', 'refinement'].map(service => ({
    id: service, presetId: '', name: service, enabled: true, service,
    protocol: service === 'transcription' ? 'openai-transcription' : 'openai-chat', endpoint: 'https://fixture.example/v1',
    apiKey: 'offline-placeholder', models: ['fixture-model'], appId: '', accessToken: '', resourceId: '', apiVersion: ''
  })),
  transcription: { providerId: 'transcription', model: 'fixture-model' }, refinement: { providerId: 'refinement', model: 'fixture-model' }
}
const machines = new Set()
function machine() { const result = new RecordingMachine(); machines.add(result); return result }
async function finish(machine) {
  await machine.start()
  const id = machine.getState().context.sessionId
  assert(id)
  machine.markStreaming(id)
  machine.pushPcm(new Float32Array([.1, .2]), id)
  const finished = machine.finish()
  machine.markStopped(id)
  await finished
  return id
}
function metadata(id) { return readVoiceMetadata(history.getHistory(id)?.modeMeta?.toString() ?? null) }
function savedFallback(id = 'saved-no-audio') {
  history.upsertHistory({ id, mode: 'voice_transcript', status: HISTORY_STATUS.COMPLETED, refinedText: 'raw transcript', duration: 1200,
    modeMeta: JSON.stringify({ transcript: 'raw transcript', detectedLanguage: 'en', refinement: { kind: 'fallback', message: 'old provider failure' } }) })
  return id
}
const failures = []
let checks = 0
async function test(name, run) {
  config = { ...structuredClone(DEFAULT_SETTINGS), serviceProviders: structuredClone(readyProviders), historyEnabled: true, saveAudio: true }
  transcribeImpl = async () => ({ text: 'raw transcript', detectedLanguage: 'en', provider: 'offline-asr' })
  refineImpl = async () => ({ text: 'refined transcript' })
  asrCalls = 0; refinementCalls = 0; actionCalls = 0; learningCalls = 0; encoded = 0; writeHook = null; capturedContext = null; liveFactory = null
  insertionResult = { ok: true, method: 'native', verification: 'verified' }
  for (const list of [writes, insertions, cards, broadcasts, providerConfigs]) list.length = 0
  raw.exec('DELETE FROM history_v2')
  for (const file of fs.readdirSync(temporary)) fs.unlinkSync(path.join(temporary, file))
  try { await run(); checks++; process.stdout.write(`PASS ${name}\n`) }
  catch (error) { failures.push({ name, error }); process.stderr.write(`FAIL ${name}: ${error.stack}\n`) }
  finally { for (const value of machines) value.cancel(); machines.clear() }
}

async function main() {
  await test('live ASR starts before PCM, receives drained tail and delivers only the final result once', async () => {
    config.serviceProviders.profiles[0].protocol = 'openai-realtime'
    const chunks = [], partials = [], value = machine()
    let finishCalls = 0, requestSignal
    const completed = deferred()
    liveFactory = (_profile, _model, request, onPartial) => {
      assert.equal(value.getState().phase, 'starting')
      requestSignal = request.signal
      return { result: completed.promise, pushPcm: chunk => { chunks.push([...chunk]); onPartial('draft only') },
        finish: () => { finishCalls++; completed.resolve({ text: 'live final transcript', detectedLanguage: 'en', provider: 'live-provider' }); return completed.promise }, abort() {} }
    }
    value.on('result', result => partials.push(result))
    await value.start()
    const id = value.getState().context.sessionId
    value.markStreaming(id); value.markStreaming(id)
    value.pushPcm(new Float32Array([0.25, 0.5]), id)
    assert.equal(partials.length, 0); assert.equal(insertions.length, 0); assert.equal(asrCalls, 0)
    assert.equal(requestSignal.aborted, false)
    const finishing = value.finish()
    value.pushPcm(new Float32Array([0.75]), id); value.markStopped(id)
    await finishing
    assert.deepEqual(chunks, [[0.25, 0.5], [0.75]])
    assert.equal(finishCalls, 1)
    assert.equal(asrCalls, 0)
    assert.equal(partials.length, 1)
    assert.equal(partials[0].transcript, 'live final transcript')
    assert.equal(metadata(id).asr.kind, 'final'); assert.equal(metadata(id).asr.path, 'live')
    assert.equal(metadata(id).asr.asrText, 'live final transcript')
    assert(broadcasts.some(([channel, event]) => channel === 'recording-machine:partial' && event.sessionId === id))
  })
  await test('live failure retries the complete PCM once and records batch-fallback metadata', async () => {
    config.serviceProviders.profiles[0].protocol = 'openai-realtime'
    const failed = Promise.reject(new Error('offline connection closed')); void failed.catch(() => {})
    liveFactory = () => ({ result: failed, pushPcm() {}, finish: () => failed, abort() {} })
    transcribeImpl = async request => { assert.deepEqual([...request.pcm], [0.10000000149011612, 0.20000000298023224]); return { text: 'recovered final', detectedLanguage: 'en', provider: 'batch-fixture' } }
    const id = await finish(machine())
    assert.equal(asrCalls, 1); assert.equal(insertions.length, 1)
    assert.equal(metadata(id).asr.path, 'batch-fallback'); assert.equal(metadata(id).asr.asrText, 'recovered final')
  })
  await test('successful live ASR skips Opus encoding when audio saving is disabled', async () => {
    config.serviceProviders.profiles[0].protocol = 'openai-realtime'; config.saveAudio = false
    const completed = Promise.resolve({ text: 'live text', detectedLanguage: 'en', provider: 'fixture' })
    liveFactory = () => ({ result: completed, pushPcm() {}, finish: () => completed, abort() {} })
    const id = await finish(machine())
    assert.equal(encoded, 0); assert.equal(writes.length, 0); assert.equal(asrCalls, 0)
    assert.equal(metadata(id).asr.path, 'live')
  })
  await test('cancelled live results cannot deliver or publish partials into the next session', async () => {
    config.serviceProviders.profiles[0].protocol = 'openai-realtime'
    const completed = deferred(), value = machine()
    let emitPartial
    liveFactory = (_profile, _model, _request, onPartial) => { emitPartial = onPartial; return { result: completed.promise, pushPcm() {}, finish: () => completed.promise, abort() {} } }
    await value.start(); const oldId = value.getState().context.sessionId; value.markStreaming(oldId)
    value.pushPcm(new Float32Array([0.25]), oldId)
    value.cancel(); await value.start()
    const nextId = value.getState().context.sessionId, count = broadcasts.length
    emitPartial('late partial'); completed.resolve({ text: 'late final', detectedLanguage: 'en', provider: 'fixture' })
    await flush()
    assert.equal(value.getState().context.sessionId, nextId); assert.equal(broadcasts.length, count)
    assert.equal(insertions.length, 0)
  })
  // Static Typeless 2.8.3 evidence, renderer/static/js/juYOhWy9.mjs character offsets:
  // @137400/@137652/@138239 guard delivery with refinedText.trim().length > 0;
  // @153706 emits an empty completion for a short-audio case; @182354 returns idle.
  // These extracted client branches do not prove live server behavior for silence.
  function observeQuiet(value) {
    const results = [], cancellations = [], phases = []
    value.on('result', result => results.push(result))
    value.on('practice-result', result => results.push(result))
    value.on('cancel', () => cancellations.push(true))
    value.on('state', state => phases.push(state.phase))
    return () => {
      const { phase, context } = value.getState()
      assert.equal(phase, 'idle')
      assert.equal(context.sessionId, null); assert.equal(context.error, null); assert.equal(context.issue, null)
      assert.equal(context.handsFree, false); assert.equal(context.recorderState.isStartingMicrophone, false)
      assert.equal(context.recorderTimeoutState, null)
      assert.equal(phases.includes('error'), false)
      assert.equal(results.length, 0); assert.equal(cards.length, 0)
      assert.equal(refinementCalls, 0); assert.equal(actionCalls, 0)
      assert.equal(insertions.length, 0); assert.equal(learningCalls, 0)
      assert.equal(broadcasts.some(([channel, event]) => channel === 'page:floating-bar-click' && ['done', 'error'].includes(event)), false)
      return cancellations
    }
  }
  for (const mode of ['voice_transcript', 'voice_command', 'ask_anything', 'translation', 'desktop_command']) {
    for (const text of ['', ' \t\n ']) {
      await test(`successful ${JSON.stringify(text)} ASR quietly completes ${mode}`, async () => {
        config.dictationMode = mode; config.dictionaryLearning = true; config.desktopCommandsEnabled = true
        transcribeImpl = async () => ({ text, detectedLanguage: null, provider: 'fixture' })
        const value = machine(), quiet = observeQuiet(value), id = await finish(value)
        assert.equal(quiet().length, 0)
        const row = history.getHistory(id)
        assert.equal(row.status, HISTORY_STATUS.COMPLETED); assert.equal(row.debugInfo, '')
        assert.equal(row.refinedText, ''); assert.equal(metadata(id).asr.kind, 'empty')
        assert.equal(metadata(id).asr.path, 'batch')
        assert.equal(history.listHistory().items[0].hasAudio, true)
        assert.equal('aiResult' in JSON.parse(row.modeMeta), false)
        assert.equal(asrCalls, 1)
      })
    }
  }
  await test('Fn start and stop quietly completes empty ordinary typing without a writing model', async () => {
    config.serviceProviders.refinement = { providerId: '', model: '' }
    transcribeImpl = async () => ({ text: '', detectedLanguage: null, provider: 'fixture' })
    const value = machine(), quiet = observeQuiet(value)
    const startGesture = Symbol('start')
    await value.dispatch({ type: 'SHORTCUT_PRESS', gestureId: startGesture, mode: 'voice_transcript' })
    const id = value.getState().context.sessionId
    value.markStreaming(id); value.pushPcm(new Float32Array([0, 0]), id)
    await value.dispatch({ type: 'SHORTCUT_RELEASE', gestureId: startGesture, action: 'hands-free' })
    assert.equal(value.getState().context.handsFree, true)
    await value.dispatch({ type: 'SHORTCUT_PRESS', gestureId: Symbol('stop'), mode: 'voice_transcript' })
    const finishing = value.finish(); value.markStopped(id); await finishing
    quiet()
    await value.retry()
    assert.equal(value.getState().phase, 'starting')
    assert.notEqual(value.getState().context.sessionId, id)
    assert.equal(asrCalls, 1)
  })
  for (const [historyEnabled, saveAudio] of [[true, false], [false, true]]) {
    await test(`empty ASR respects history=${historyEnabled}, audio=${saveAudio}`, async () => {
      config.historyEnabled = historyEnabled; config.saveAudio = saveAudio
      transcribeImpl = async () => ({ text: '', detectedLanguage: null, provider: 'fixture' })
      const value = machine(), quiet = observeQuiet(value), id = await finish(value)
      quiet()
      assert.equal(writes.length, 0); assert.equal(fs.readdirSync(temporary).length, 0)
      if (historyEnabled) {
        assert.equal(history.getHistory(id).status, HISTORY_STATUS.COMPLETED)
        assert.equal(metadata(id).asr.kind, 'empty')
      } else assert.equal(history.getHistory(id), null)
    })
  }
  await test('successful empty live ASR skips batch fallback and delivery', async () => {
    config.serviceProviders.profiles[0].protocol = 'openai-realtime'; config.saveAudio = false
    const completed = Promise.resolve({ text: ' \n ', detectedLanguage: null, provider: 'fixture' })
    liveFactory = () => ({ result: completed, pushPcm() {}, finish: () => completed, abort() {} })
    const value = machine(), quiet = observeQuiet(value), id = await finish(value)
    quiet()
    assert.equal(asrCalls, 0); assert.equal(encoded, 0)
    assert.equal(metadata(id).asr.kind, 'empty'); assert.equal(metadata(id).asr.path, 'live')
  })
  await test('live failure followed by successful empty batch ASR quietly completes', async () => {
    config.serviceProviders.profiles[0].protocol = 'openai-realtime'
    const failed = Promise.reject(new Error('offline network failure')); void failed.catch(() => {})
    liveFactory = () => ({ result: failed, pushPcm() {}, finish: () => failed, abort() {} })
    transcribeImpl = async () => ({ text: '', detectedLanguage: null, provider: 'fixture' })
    const value = machine(), quiet = observeQuiet(value), id = await finish(value)
    quiet()
    assert.equal(asrCalls, 1); assert.equal(metadata(id).asr.kind, 'empty')
    assert.equal(metadata(id).asr.path, 'batch-fallback')
  })
  for (const live of [false, true]) {
    await test(`${live ? 'live and batch' : 'batch'} provider failure remains a retryable error`, async () => {
      if (live) {
        config.serviceProviders.profiles[0].protocol = 'openai-realtime'
        const failed = Promise.reject(new Error('offline network failure')); void failed.catch(() => {})
        liveFactory = () => ({ result: failed, pushPcm() {}, finish: () => failed, abort() {} })
      }
      // Even a provider error mentioning silence is a failure, not successful empty ASR.
      transcribeImpl = async () => { throw new Error('No speech detected: offline network failure') }
      const value = machine(), id = await finish(value)
      assert.equal(value.getState().phase, 'error'); assert.equal(value.getState().context.issue.canRetry, true)
      assert.equal(history.getHistory(id).status, HISTORY_STATUS.FAILED)
      assert.equal(metadata(id).asr.kind, 'failed'); assert.equal(metadata(id).asr.reason, 'network')
      assert.equal(refinementCalls, 0); assert.equal(actionCalls, 0); assert.equal(insertions.length, 0)
    })
  }
  await test('late empty batch completion cannot reset a new session or replace cancellation history', async () => {
    const entered = deferred(), gate = deferred(), value = machine()
    transcribeImpl = async () => { entered.resolve(); return gate.promise }
    const pending = finish(value)
    await entered.promise
    const oldId = value.getState().context.sessionId
    value.cancel(); await value.start()
    const nextId = value.getState().context.sessionId, count = broadcasts.length
    gate.resolve({ text: '', detectedLanguage: null, provider: 'fixture' }); await pending
    assert.equal(value.getState().context.sessionId, nextId); assert.equal(value.getState().phase, 'starting')
    assert.equal(broadcasts.length, count); assert.equal(history.getHistory(oldId).status, HISTORY_STATUS.CANCELLED)
    assert.equal(history.getHistory(nextId), null); assert.equal(refinementCalls, 0); assert.equal(insertions.length, 0)
  })
  await test('late empty live completion cannot reset a new session or deliver', async () => {
    config.serviceProviders.profiles[0].protocol = 'openai-realtime'; config.saveAudio = false
    const completed = deferred(), value = machine(), entered = deferred()
    let emitPartial
    liveFactory = (_profile, _model, _request, onPartial) => {
      emitPartial = onPartial
      return { result: completed.promise, pushPcm() {}, finish: () => { entered.resolve(); return completed.promise }, abort() {} }
    }
    const pending = finish(value)
    await entered.promise; await flush()
    value.cancel(); await value.start()
    const nextId = value.getState().context.sessionId, count = broadcasts.length
    emitPartial('stale partial'); completed.resolve({ text: '', detectedLanguage: null, provider: 'fixture' }); await pending
    assert.equal(value.getState().context.sessionId, nextId); assert.equal(value.getState().phase, 'starting')
    assert.equal(broadcasts.length, count); assert.equal(insertions.length, 0); assert.equal(cards.length, 0)
    assert.equal(asrCalls, 0); assert.equal(refinementCalls, 0)
  })
  await test('stopping before any PCM quietly returns idle without calling ASR', async () => {
    const value = machine(), quiet = observeQuiet(value)
    await value.start(); const id = value.getState().context.sessionId
    const pending = value.finish(); value.markStopped(id); await pending
    quiet()
    assert.equal(asrCalls, 0); assert.equal(history.getHistory(id), null); assert.equal(writes.length, 0)
  })
  await test('history audio retry with empty ASR completes the same row without delivery', async () => {
    transcribeImpl = async () => { throw new Error('offline ASR failure') }
    const value = machine(), id = await finish(value)
    broadcasts.length = 0
    const quiet = observeQuiet(value)
    transcribeImpl = async () => ({ text: '', detectedLanguage: null, provider: 'fixture' })
    await value.retryHistory(id)
    quiet()
    assert.equal(history.getLatest().length, 1); assert.equal(history.getHistory(id).status, HISTORY_STATUS.COMPLETED)
    assert.equal(metadata(id).asr.kind, 'empty')
    assert.equal(history.getHistory(id).debugInfo, '')
  })
  await test('new writing controls reach the refinement provider and prompt version reaches history', async () => {
    config.polishLevel = 'raw'; config.writingStyle = 'formal'; config.autoPunctuation = false
    refineImpl = async request => {
      assert.equal(request.polishLevel, 'raw'); assert.equal(request.writingStyle, 'formal'); assert.equal(request.autoPunctuation, false)
      return { text: request.transcript }
    }
    const id = await finish(machine())
    assert.equal(metadata(id).refinement.changed, false)
    assert.equal(metadata(id).refinement.promptVersion, 'dictation-2026-10-24.3')
    assert.equal(metadata(id).asr.model, 'fixture-model')
  })
  for (const level of ['raw', 'light', 'strong']) {
    await test(`native ASR cleanup respects ${level} and retains its own metadata`, async () => {
      config.polishLevel = level
      transcribeImpl = async request => {
        assert.equal(request.providerPolish, level !== 'raw')
        return { text: 'provider final text', detectedLanguage: 'zh', provider: 'offline-asr', providerPolish: request.providerPolish }
      }
      const id = await finish(machine())
      assert.equal(metadata(id).asr.providerPolish, level !== 'raw')
      assert.equal(history.listHistory().items.find(item => item.id === id).providerPolish, level !== 'raw')
      assert.equal(metadata(id).refinement.kind, 'completed', 'a configured writing model remains a separate explicit step')
    })
  }
  const contextFixture = {
    focusedApp: { appName: 'Offline editor', bundleId: 'test.editor', windowTitle: 'Document', webTitle: null, webDomain: null, webUrl: null, capturedAt: 1 },
    focusedInput: { role: 'text', valuePreview: 'private input preview', selectedText: 'private selected text', isSecure: false },
    visibleText: 'private visible text', screenContent: 'private screen content'
  }
  const privacyCases = [
    { name: 'context allowed', focused: true, screen: true, secure: false },
    { name: 'all context disabled', focused: false, screen: true, secure: false },
    { name: 'screen context disabled', focused: true, screen: false, secure: false },
    { name: 'secure input', focused: true, screen: true, secure: true }
  ]
  function assertPrivateContext(context, privacy) {
    if (!privacy.focused) { assert.equal(context, null); return }
    assert.equal(context.focusedApp.appName, 'Offline editor')
    assert.equal(context.visibleText, privacy.screen && !privacy.secure ? 'private visible text' : null)
    assert.equal(context.screenContent, privacy.screen && !privacy.secure ? 'private screen content' : null)
    assert.equal(context.focusedInput.selectedText, privacy.secure ? null : 'private selected text')
    assert.equal(context.focusedInput.valuePreview, privacy.secure ? null : 'private input preview')
  }
  for (const privacy of privacyCases) {
    await test(`memory refinement retry respects current privacy: ${privacy.name}`, async () => {
      config.sendFocusedAppContext = true; config.sendScreenContext = true
      capturedContext = { ...structuredClone(contextFixture), focusedInput: { ...contextFixture.focusedInput, isSecure: privacy.secure } }
      refineImpl = async () => { throw new Error('offline first refinement failure') }
      const value = machine(), id = await finish(value)
      config.sendFocusedAppContext = privacy.focused; config.sendScreenContext = privacy.screen
      refineImpl = async request => { assertPrivateContext(request.context, privacy); return { text: 'private retry completed' } }
      await value.retry()
      assert.equal(asrCalls, 1)
      assert.deepEqual(insertions, ['raw transcript'])
      assert.equal(history.getHistory(id).refinedText, 'private retry completed')
      assert.equal(history.listHistory().total, 1)
    })
    await test(`memory audio retry respects current privacy: ${privacy.name}`, async () => {
      config.sendFocusedAppContext = true; config.sendScreenContext = true
      capturedContext = { ...structuredClone(contextFixture), focusedInput: { ...contextFixture.focusedInput, isSecure: privacy.secure } }
      transcribeImpl = async () => { throw new Error('offline first ASR failure') }
      const value = machine()
      await finish(value)
      config.sendFocusedAppContext = privacy.focused; config.sendScreenContext = privacy.screen
      transcribeImpl = async request => { assertPrivateContext(request.context, privacy); return { text: 'private retry completed', detectedLanguage: 'en', provider: 'offline-asr' } }
      refineImpl = async request => { assertPrivateContext(request.context, privacy); return { text: request.transcript } }
      await value.retry()
      assert.equal(asrCalls, 2)
      assert.deepEqual(insertions, ['private retry completed'])
    })
    await test(`saved refinement retry respects current privacy: ${privacy.name}`, async () => {
      const id = savedFallback()
      const context = { ...structuredClone(contextFixture), focusedInput: { ...contextFixture.focusedInput, isSecure: privacy.secure } }
      history.upsertHistory({ id, audioContext: JSON.stringify(context) })
      config.sendFocusedAppContext = privacy.focused; config.sendScreenContext = privacy.screen
      refineImpl = async request => { assertPrivateContext(request.context, privacy); return { text: 'private retry completed' } }
      await machine().retryHistory(id)
      assert.equal(asrCalls, 0)
      assert.deepEqual(insertions, [])
      assert.equal(history.getHistory(id).refinedText, 'private retry completed')
    })
    await test(`saved audio retry respects current privacy: ${privacy.name}`, async () => {
      const id = 'saved-private-audio', file = path.join(temporary, `${id}.ogg`)
      fs.writeFileSync(file, 'offline-saved-audio')
      const context = { ...structuredClone(contextFixture), focusedInput: { ...contextFixture.focusedInput, isSecure: privacy.secure } }
      history.upsertHistory({ id, mode: 'voice_transcript', status: HISTORY_STATUS.FAILED, audioLocalPath: file, audioContext: JSON.stringify(context) })
      config.sendFocusedAppContext = privacy.focused; config.sendScreenContext = privacy.screen
      transcribeImpl = async request => { assertPrivateContext(request.context, privacy); return { text: 'private saved retry', detectedLanguage: 'en', provider: 'offline-asr' } }
      refineImpl = async request => { assertPrivateContext(request.context, privacy); return { text: request.transcript } }
      await machine().retryHistory(id)
      assert.equal(asrCalls, 1)
      assert.deepEqual(insertions, [])
      assert.equal(history.getHistory(id).refinedText, 'private saved retry')
      assert.equal(history.getHistory(id).audioLocalPath, file)
    })
  }
  await test('ASR failure retains encoded audio in history before the model request', async () => {
    transcribeImpl = async () => {
      const row = history.getLatest()[0]
      assert(row.audioLocalPath)
      assert.equal(fs.readFileSync(row.audioLocalPath).toString(), 'offline-encoded-audio')
      throw new Error('offline ASR failure')
    }
    const value = machine(), id = await finish(value), row = history.getHistory(id)
    assert.equal(row.status, HISTORY_STATUS.FAILED)
    assert.equal(value.getState().context.issue.canRetry, true)
    assert.equal(writes.length, 1)
    assert.equal(encoded, 1)
    assert.equal(asrCalls, 1)
    assert.equal(refinementCalls, 0)
    assert.equal(history.listHistory().items[0].hasAudio, true)
  })
  await test('audio privacy switches suppress disk writes and disabled history stays empty', async () => {
    for (const [historyEnabled, saveAudio] of [[true, false], [false, true]]) {
      config.historyEnabled = historyEnabled; config.saveAudio = saveAudio
      const value = machine(), id = await finish(value)
      assert.equal(writes.length, 0)
      assert.equal(fs.readdirSync(temporary).length, 0)
      if (historyEnabled) assert.equal(history.getHistory(id).audioLocalPath, null)
      else assert.equal(history.getHistory(id), null)
    }
  })
  await test('cancelling an audio write removes the orphan and never calls ASR', async () => {
    const entered = deferred(), gate = deferred()
    writeHook = async () => { entered.resolve(); await gate.promise }
    const value = machine()
    const finishing = finish(value)
    await entered.promise
    const id = history.getLatest()[0].id
    value.cancel()
    gate.resolve()
    await finishing
    assert.equal(history.getHistory(id).status, HISTORY_STATUS.CANCELLED)
    assert.equal(history.getHistory(id).audioLocalPath, null)
    assert.equal(fs.readdirSync(temporary).length, 0)
    assert.equal(asrCalls, 0)
  })
  await test('fallback persists raw text and warning; retry only refines and opens one card', async () => {
    refineImpl = async () => { throw new Error('offline refinement failure') }
    const value = machine(), results = []
    value.on('result', result => results.push(result))
    const id = await finish(value)
    assert.equal(value.getState().context.issue.kind, 'refinement')
    assert.equal(value.getState().context.issue.canRetry, true)
    assert.equal(metadata(id).transcript, 'raw transcript')
    assert.equal(metadata(id).refinement.kind, 'fallback')
    assert.equal(history.listHistory().items[0].refinement.kind, 'fallback')
    assert.deepEqual(insertions, ['raw transcript'])
    refineImpl = async () => ({ text: 'recovered refinement' })
    await value.retry()
    assert.equal(asrCalls, 1)
    assert.equal(refinementCalls, 2)
    assert.deepEqual(insertions, ['raw transcript'])
    assert.equal(cards.length, 1)
    assert.equal(cards[0].answer, 'recovered refinement')
    assert.equal(results.at(-1).delivery, 'card')
    assert.equal(results.at(-1).id, id)
    assert.equal(history.listHistory().total, 1)
    assert.equal(history.getHistory(id).refinedText, 'recovered refinement')
    assert.equal(metadata(id).refinement.kind, 'completed')
    assert.equal(value.getState().context.issue, null)
  })
  await test('cancelled refinement retry cannot deliver into a later recording', async () => {
    refineImpl = async () => { throw new Error('first refinement failure') }
    const value = machine(), id = await finish(value), gate = deferred(), entered = deferred()
    refineImpl = async () => { entered.resolve(); return gate.promise }
    const retrying = value.retry()
    await entered.promise
    value.cancel()
    await value.start()
    const nextId = value.getState().context.sessionId
    assert(nextId && nextId !== id)
    value.markStreaming(nextId)
    gate.resolve({ text: 'stale refinement' })
    await retrying
    assert.equal(value.getState().context.sessionId, nextId)
    assert.equal(value.getState().phase, 'recording')
    assert.deepEqual(insertions, ['raw transcript'])
    assert.equal(cards.length, 0)
    assert.equal(history.getHistory(id).refinedText, 'raw transcript')
    assert.equal(metadata(id).refinement.kind, 'fallback')
  })
  await test('saved fallback retries without audio or ASR and preserves the history id', async () => {
    const id = savedFallback(), value = machine()
    config.historyEnabled = false
    await value.retryHistory(id)
    assert.equal(asrCalls, 0)
    assert.equal(encoded, 0)
    assert.equal(refinementCalls, 1)
    assert.equal(insertions.length, 0)
    assert.equal(cards.length, 1)
    assert.equal(cards[0].id, id)
    assert.equal(history.listHistory().total, 1)
    assert.equal(history.getHistory(id).refinedText, 'refined transcript')
    assert.equal(metadata(id).transcript, 'raw transcript')
    assert.equal(metadata(id).refinement.kind, 'completed')
  })
  await test('a failed saved refinement retry preserves fallback metadata for another attempt', async () => {
    const id = savedFallback(), value = machine()
    config.serviceProviders.refinement = null
    await assert.rejects(value.retryHistory(id), /default writing model/)
    assert.equal(history.getHistory(id).status, HISTORY_STATUS.FAILED)
    assert.equal(history.getHistory(id).refinedText, 'raw transcript')
    assert.equal(metadata(id).transcript, 'raw transcript')
    assert.equal(metadata(id).refinement.kind, 'fallback')
    assert.equal(metadata(id).refinement.message, 'old provider failure')
    config.serviceProviders = structuredClone(readyProviders)
    await value.retryHistory(id)
    assert.equal(asrCalls, 0)
    assert.equal(refinementCalls, 1)
    assert.equal(metadata(id).refinement.kind, 'completed')
  })
  await test('a provider failure during refinement retry keeps raw fallback and never reinserts', async () => {
    refineImpl = async () => { throw new Error('first provider failure') }
    const value = machine(), id = await finish(value)
    refineImpl = async () => { throw new Error('second provider failure') }
    await value.retry()
    assert.equal(metadata(id).transcript, 'raw transcript')
    assert.equal(metadata(id).refinement.kind, 'fallback')
    assert.match(metadata(id).refinement.message, /second provider failure/)
    assert.equal(value.getState().context.issue.kind, 'refinement')
    assert.equal(asrCalls, 1)
    assert.deepEqual(insertions, ['raw transcript'])
    refineImpl = async () => ({ text: 'third attempt succeeds' })
    await value.retry()
    assert.equal(metadata(id).refinement.kind, 'completed')
    assert.equal(history.getHistory(id).refinedText, 'third attempt succeeds')
    assert.deepEqual(insertions, ['raw transcript'])
  })
  await test('floating refinement retry uses current writing controls without repeating ASR or insertion', async () => {
    config.polishLevel = 'light'
    refineImpl = async () => { throw new Error('first writing request failed') }
    const value = machine(), id = await finish(value), originalAsr = metadata(id).asr
    config.polishLevel = 'strong'; config.writingStyle = 'formal'; config.autoPunctuation = false
    config.customInstructions = 'Keep the final schedule'
    refineImpl = async request => {
      assert.equal(request.polishLevel, 'strong')
      assert.equal(request.writingStyle, 'formal')
      assert.equal(request.autoPunctuation, false)
      assert.equal(request.instructions, 'Keep the final schedule')
      return { text: 'rewritten with current settings' }
    }
    await value.retry()
    assert.equal(metadata(id).refinement.kind, 'completed')
    assert.equal(metadata(id).refinement.polishLevel, 'strong')
    assert.deepEqual(metadata(id).asr, originalAsr)
    assert.equal(asrCalls, 1)
    assert.deepEqual(insertions, ['raw transcript'])
    assert.equal(cards.at(-1).answer, 'rewritten with current settings')
  })
  await test('successful history can refine again with current settings and no saved audio', async () => {
    const id = savedFallback('successful-no-audio')
    history.upsertHistory({ id, refinedText: 'previous writing', modeMeta: JSON.stringify({ transcript: 'raw transcript',
      refinement: { kind: 'completed', changed: true, polishLevel: 'light' } }) })
    config.polishLevel = 'strong'; config.writingStyle = 'concise'
    refineImpl = async request => {
      assert.equal(request.transcript, 'raw transcript')
      assert.equal(request.polishLevel, 'strong')
      assert.equal(request.writingStyle, 'concise')
      return { text: 'new deep rewrite' }
    }
    await machine().retryHistory(id, 'refine')
    assert.equal(asrCalls, 0); assert.equal(encoded, 0); assert.equal(insertions.length, 0)
    assert.equal(history.getHistory(id).refinedText, 'new deep rewrite')
    assert.equal(history.listHistory().items[0].transcript, 'raw transcript')
    assert.equal(metadata(id).refinement.polishLevel, 'strong')
    assert.equal(cards.at(-1).refinement.changed, true)
  })
  await test('failed explicit re-refinement leaves previous writing and metadata untouched', async () => {
    const id = savedFallback('keep-previous-writing')
    history.upsertHistory({ id, refinedText: 'previous good result', modeMeta: JSON.stringify({ transcript: 'raw transcript',
      refinement: { kind: 'completed', changed: true, polishLevel: 'light' } }) })
    const original = history.getHistory(id)
    refineImpl = async () => { throw new Error('new provider failed') }
    await assert.rejects(machine().retryHistory(id, 'refine'), /new provider failed/)
    assert.equal(history.getHistory(id).refinedText, original.refinedText)
    assert.equal(history.getHistory(id).status, original.status)
    assert.equal(history.getHistory(id).modeMeta.toString(), original.modeMeta.toString())
    assert.equal(cards.length, 0); assert.equal(insertions.length, 0); assert.equal(asrCalls, 0)
  })
  await test('explicit refinement does not execute saved desktop commands or overwrite history on missing model', async () => {
    const id = savedFallback('missing-current-model'), original = history.getHistory(id)
    config.serviceProviders.refinement = null
    await assert.rejects(machine().retryHistory(id, 'refine'), /default writing model/)
    assert.equal(history.getHistory(id).status, original.status)
    assert.equal(history.getHistory(id).modeMeta.toString(), original.modeMeta.toString())
    config.serviceProviders = structuredClone(readyProviders)
    history.upsertHistory({ id: 'saved-command', mode: 'desktop_command', modeMeta: JSON.stringify({ transcript: 'open notes' }) })
    await assert.rejects(machine().retryHistory('saved-command', 'refine'), /dictation/)
    assert.equal(asrCalls, 0); assert.equal(refinementCalls, 0); assert.equal(cards.length, 0)
  })
  await test('skipped and unchanged refinement are distinct and record actual request settings', async () => {
    config.serviceProviders.refinement = null
    const first = await finish(machine())
    assert.equal(metadata(first).refinement.reason, 'no-default-provider')
    config.serviceProviders = structuredClone(readyProviders)
    config.polishLevel = 'strong'
    refineImpl = async request => ({ text: request.transcript })
    const second = await finish(machine())
    assert.equal(metadata(second).refinement.kind, 'completed')
    assert.equal(metadata(second).refinement.changed, false)
    assert.equal(metadata(second).refinement.polishLevel, 'strong')
    assert.equal(metadata(second).refinement.providerId, 'refinement')
  })
  await test('explicit history refinement is cancelled without overwriting the previous result', async () => {
    const id = savedFallback('cancel-explicit-refinement'), value = machine(), gate = deferred(), entered = deferred()
    const original = history.getHistory(id)
    refineImpl = async () => { entered.resolve(); return gate.promise }
    const pending = value.retryHistory(id, 'refine')
    await entered.promise
    value.cancel()
    gate.resolve({ text: 'late writing result' })
    await assert.rejects(pending, /cancel/i)
    assert.equal(history.getHistory(id).refinedText, original.refinedText)
    assert.equal(history.getHistory(id).status, original.status)
    assert.equal(cards.length, 0); assert.equal(insertions.length, 0)
  })
  await test('explicit history refinement cannot resurrect a deleted recording', async () => {
    const id = savedFallback('deleted-during-refinement'), value = machine(), gate = deferred(), entered = deferred()
    refineImpl = async () => { entered.resolve(); return gate.promise }
    const pending = value.retryHistory(id, 'refine')
    await entered.promise
    history.deleteHistory(id)
    gate.resolve({ text: 'must not recreate deleted history' })
    await assert.rejects(pending, /no longer available/)
    assert.equal(history.getHistory(id), null)
    assert.equal(cards.length, 0); assert.equal(insertions.length, 0)
  })
  await test('history-refine IPC validates its ID and returns the actual writing metadata', async () => {
    const handlers = new Map()
    load('src/main/ipc/history.ts').registerHistoryHandlers((channel, handler) => handlers.set(channel, handler))
    const handler = handlers.get('db:history-refine'), id = savedFallback('ipc-refinement')
    config.polishLevel = 'strong'
    await assert.rejects(handler({}, { id }))
    const result = await handler({}, id)
    assert.equal(result.id, id)
    assert.equal(result.refinedText, 'refined transcript')
    assert.equal(result.refinement.polishLevel, 'strong')
    assert.equal(asrCalls, 0); assert.equal(refinementCalls, 1); assert.equal(insertions.length, 0)
  })
  await test('unverified automatic insertion stays quiet and persists only the verification verdict', async () => {
    insertionResult = { method: 'native', ok: false, verification: 'unknown', error: 'text-mismatch' }
    const value = machine(), results = []
    value.on('result', result => results.push(result))
    const id = await finish(value)
    assert.equal(results[0].delivery, 'unverified')
    assert.equal(cards.length, 0, 'a readback limitation must not open a result window')
    assert.equal(metadata(id).insertion.error, 'text-mismatch')
    assert.equal(history.listHistory().items[0].insertion.verification, 'unknown')
    assert.equal(insertions.length, 1)
    assert.equal('value' in metadata(id).insertion, false)
  })
  await test('unreadable editors do not open a result card after automatic dictation', async () => {
    insertionResult = { method: 'native', ok: false, verification: 'unknown', error: 'unreadable-input' }
    const value = machine(), results = []
    value.on('result', result => results.push(result))
    await finish(value)
    assert.equal(results[0].delivery, 'unverified'); assert.equal(cards.length, 0)
    assert.equal(insertions.length, 1); assert.equal(learningCalls, 0)
  })
  for (const outcome of [
    {method:'native',ok:false,verification:'blocked',error:'secure-input'},
    {method:'native',ok:false,verification:'unknown',error:'native-dispatch-error'}
  ]) await test(`real ${outcome.error} still exposes recoverable text`, async () => {
    insertionResult = outcome
    const value = machine()
    await finish(value)
    assert.equal(cards.length, 1); assert.equal(cards[0].answer, 'refined transcript')
    assert.equal(insertions.length, 1)
  })
  process.stdout.write(`Voice recovery: ${checks} behavioral checks passed; ${failures.length} failed.\n`)
  if (failures.length) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  for (const value of machines) value.cancel()
  await flush()
  raw.close()
  fs.rmSync(temporary, { recursive: true, force: true })
})
