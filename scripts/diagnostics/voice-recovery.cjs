// Real recording, transcription and history modules; only peripheral boundaries are isolated.
// Run with ELECTRON_RUN_AS_NODE=1 electron scripts/diagnostics/voice-recovery.cjs.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const ts = require('typescript')
const Database = require('better-sqlite3')
const { drizzle } = require('drizzle-orm/better-sqlite3')
const root = path.resolve(__dirname, '../..')
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

let config, writeHook = null, transcribeImpl, refineImpl, capturedContext = null
const writes = [], insertions = [], cards = [], broadcasts = [], providerConfigs = []
let asrCalls = 0, refinementCalls = 0, encoded = 0
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
  return { ok: true }
} })
replace('src/main/services/voiceActions.ts', { runVoiceAction: async () => 'offline action' })
replace('src/main/services/providers/index.ts', { createProviders: (_legacy, state) => {
  providerConfigs.push(structuredClone(state))
  return {
    transcription: { transcribe: async request => { asrCalls++; return transcribeImpl(request) } },
    refinement: { refine: async request => { refinementCalls++; return refineImpl(request) } }
  }
} })
const schema = load('src/main/db/schema.ts')
const raw = new Database(':memory:')
for (const file of fs.readdirSync(path.join(root, 'src/main/db/sql')).filter(file => file.endsWith('.sql')).sort()) {
  raw.exec(fs.readFileSync(path.join(root, 'src/main/db/sql', file), 'utf8'))
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
  asrCalls = 0; refinementCalls = 0; encoded = 0; writeHook = null; capturedContext = null
  for (const list of [writes, insertions, cards, broadcasts, providerConfigs]) list.length = 0
  raw.exec('DELETE FROM history_v2')
  for (const file of fs.readdirSync(temporary)) fs.unlinkSync(path.join(temporary, file))
  try { await run(); checks++; process.stdout.write(`PASS ${name}\n`) }
  catch (error) { failures.push({ name, error }); process.stderr.write(`FAIL ${name}: ${error.stack}\n`) }
  finally { for (const value of machines) value.cancel(); machines.clear() }
}

async function main() {
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
  process.stdout.write(`Voice recovery: ${checks} behavioral checks passed; ${failures.length} failed.\n`)
  if (failures.length) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  for (const value of machines) value.cancel()
  await flush()
  raw.close()
  fs.rmSync(temporary, { recursive: true, force: true })
})
