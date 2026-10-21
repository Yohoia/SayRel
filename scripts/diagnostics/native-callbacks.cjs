const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const ts = require('typescript'), real = require('koffi')
const root = path.resolve(__dirname, '../..'), callbacks = new Map(), timers = new Set()
let respond = cb => callbacks.get(cb)('{"appName":"fixture"}')
const koffi = { ...real,
  register(fn, type) { const cb = real.register(fn, type); callbacks.set(cb, fn); return cb },
  unregister(cb) { real.unregister(cb); callbacks.delete(cb) },
  load() { return { func(name) { return name.endsWith('Async') ? cb => respond(cb) : () => 0 } } }
}
const imports = {
  koffi, 'node:path': path, './paths': { paths: { helpers: '/unused-native-fixture' } },
  './logger': { createLogger: () => ({ error() {}, warn() {} }) }
}
const source = ts.transpileModule(fs.readFileSync(path.join(root, 'src/main/lib/native.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText
const native = {}
new Function('require', 'exports', 'setTimeout', 'clearTimeout', source)(name => imports[name], native,
  fn => { timers.add(fn); return fn }, fn => timers.delete(fn))
const persistentSlots = callbacks.size
async function main() {
  for (let i = 0; i < 8300; i++) {
    assert.equal((await native.context.getFocusedAppInfo()).appName, 'fixture')
    assert.equal(callbacks.size, persistentSlots, 'completed context request must release its callback')
  }
  respond = cb => callbacks.get(cb)('[{"deviceId":"fixture"}]')
  for (let i = 0; i < 8300; i++) {
    assert.equal((await native.util.getAudioDevicesJSONAsync())[0].deviceId, 'fixture')
    assert.equal(callbacks.size, persistentSlots)
  }
  console.log('PASS context and device queries reuse callback slots beyond the Koffi limit')

  let delayed
  respond = cb => { delayed = cb }
  const expired = native.context.getFocusedElementInfo()
  for (const timer of [...timers]) timer()
  assert.equal(await expired, null)
  assert.equal(callbacks.size, persistentSlots + 1, 'native callback must remain callable after JS timeout')
  callbacks.get(delayed)('{"role":"late"}')
  assert.equal(callbacks.size, persistentSlots)
  console.log('PASS timed-out request releases only after its late native callback')

  respond = cb => callbacks.get(cb)('invalid json')
  assert.equal(await native.context.getFocusedAppInfo(), null)
  assert.deepEqual(await native.util.getAudioDevicesJSONAsync(), [])
  respond = () => { throw new Error('native binding failed') }
  assert.equal(await native.context.getFocusedAppInfo(), null)
  assert.deepEqual(await native.util.getAudioDevicesJSONAsync(), [])
  assert.equal(callbacks.size, persistentSlots)
  assert.equal(timers.size, 0)
  console.log('PASS malformed data and binding errors release callback registrations and timers')
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  for (const cb of [...callbacks.keys()]) koffi.unregister(cb)
})
