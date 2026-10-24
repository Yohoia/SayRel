// Replays the production microphone controller with no devices or network.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const assert = require('node:assert/strict')
const exportsObj = {}
const file = path.resolve(__dirname, '../../../src/renderer/floating-bar/sessionController.ts')
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: exportsObj, queueMicrotask, Float32Array, Set })
const { RecorderSessionController } = exportsObj
const flush = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const state = (phase, id = null) => ({ phase, context: { sessionId: id } })
function fixture(overrides = {}) {
  const events = []
  let options
  const handle = { stop: async () => events.push('stop') }
  const deps = {
    settings: async () => ({ muteWhileDictating: true }),
    isMuted: async () => false,
    mute: async () => events.push('mute'), unmute: async () => events.push('unmute'),
    start: async opts => { options = opts; events.push('open'); return handle },
    status: async (phase, payload) => events.push([phase, payload.sessionId, payload.pcm ? new Float32Array(payload.pcm).length : null]),
    onRecorder: () => undefined,
    ...overrides
  }
  return { controller: new RecorderSessionController(deps), events, handle, options: () => options }
}
async function test(name, body) { await body(); console.log(`PASS ${name}`) }
;(async () => {
  await test('starting opens once; stopped follows tail chunks and restores audio', async () => {
    const f = fixture()
    f.controller.sync(state('starting', 'a'))
    f.controller.sync(state('starting', 'a'))
    await flush()
    f.handle.stop = async () => { f.events.push('stop'); f.options().onChunk(new Float32Array(7)) }
    f.controller.sync(state('finishing', 'a'))
    f.controller.sync(state('finishing', 'a'))
    await flush()
    assert.deepEqual(f.events, ['mute', 'open', ['started', 'a', null], 'stop', ['chunk', 'a', 7], 'unmute', ['stopped', 'a', null]])
    await f.controller.dispose()
  })
  await test('release during delayed microphone open stops late stream without started', async () => {
    const gate = deferred()
    let stopped = 0
    const f = fixture({ start: () => gate.promise })
    f.controller.sync(state('starting', 'a'))
    await flush()
    f.controller.sync(state('finishing', 'a'))
    gate.resolve({ stop: async () => { stopped++ } })
    await flush()
    assert.equal(stopped, 1)
    assert.deepEqual(f.events, ['mute', 'unmute', ['stopped', 'a', null]])
    await f.controller.dispose()
  })
  await test('cancel during open closes late stream and drops old chunks', async () => {
    const gate = deferred()
    let options, stopped = 0
    const f = fixture({ start: opts => { options = opts; return gate.promise } })
    f.controller.sync(state('starting', 'a'))
    await flush()
    f.controller.sync(state('idle'))
    options.onChunk(new Float32Array(10))
    gate.resolve({ stop: async () => { stopped++ } })
    await f.controller.dispose()
    assert.equal(stopped, 1)
    assert.deepEqual(f.events, ['mute', 'unmute'])
  })
  await test('already muted audio stays muted after completion', async () => {
    const f = fixture({ isMuted: async () => true })
    f.controller.sync(state('starting', 'a'))
    await flush()
    f.controller.sync(state('finishing', 'a'))
    await flush()
    assert.equal(f.events.includes('mute'), false)
    assert.equal(f.events.includes('unmute'), false)
    await f.controller.dispose()
  })
  await test('cancel followed by new start serializes microphone cleanup', async () => {
    const gate = deferred()
    const f = fixture({ start: async () => gate.promise })
    f.controller.sync(state('starting', 'a'))
    await flush()
    f.controller.sync(state('idle'))
    f.controller.sync(state('starting', 'b'))
    gate.resolve({ stop: async () => f.events.push('stop') })
    await flush()
    assert.deepEqual(f.events, ['mute', 'stop', 'unmute', 'mute', ['started', 'b', null]])
    await f.controller.dispose()
  })
  await test('stopped waits for asynchronous chunk delivery', async () => {
    const gate = deferred(), events = []
    const f = fixture({ status: async phase => { if (phase === 'chunk') await gate.promise; events.push(phase) } })
    f.controller.sync(state('starting', 'a'))
    await flush()
    f.options().onChunk(new Float32Array(1))
    f.controller.sync(state('finishing', 'a'))
    await flush()
    assert.deepEqual(events, ['started'])
    gate.resolve()
    await flush()
    assert.deepEqual(events, ['started', 'chunk', 'stopped'])
    await f.controller.dispose()
  })
})().catch(error => { console.error(error); process.exitCode = 1 })
