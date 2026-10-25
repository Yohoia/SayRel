const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '../../..')
const cache = new Map()
let now = 0, reads = [], clipboard = [], calls = 0, code = 0, insertHook
class ClockDate extends Date { static now() { return now } }
const native = { available: true, insertText() { calls++; insertHook?.(); return code }, insertRichText() { calls++; return code },
  getCurrentInputState() { const value = reads.length > 1 ? reads.shift() : reads[0]; return JSON.stringify(value) } }
const mocks = {
  electron: { clipboard: { writeText(text) { clipboard.push(text) } } },
  '../lib/native': { input: native },
  '../lib/logger': { createLogger: () => ({ warn() {}, error() {}, info() {} }) }
}
function load(file) {
  const absolute = path.resolve(root, file.endsWith('.ts') ? file : file + '.ts')
  if (cache.has(absolute)) return cache.get(absolute)
  const exports = {}; cache.set(absolute, exports)
  const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  vm.runInNewContext(code, { exports, Date: ClockDate, setTimeout(callback, ms) { now += ms; queueMicrotask(callback) },
    require: id => mocks[id] ?? (id.startsWith('.') ? load(path.resolve(path.dirname(absolute), id)) : require(id)) }, { filename: absolute })
  return exports
}
const insertion = load('src/main/services/insertion.ts')
const state = (value, extra = {}) => ({ targetId: 'editor-one', hasFocus: true, secureInput: false, hasMarkedText: false,
  value, caretLocation: value.length, selectionLength: 0, ...extra })
let passed = 0, failed = 0
async function test(name, run) {
  now = 0; reads = [state('')]; clipboard = []; calls = 0; code = 0; insertHook = undefined; native.available = true
  try { await run(); passed++; console.log('PASS ' + name) }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message) }
}
async function main() {
  await test('native zero is verified only after the exact replacement appears in the same target', async () => {
    reads = [state('A old Z', { caretLocation: 2, selectionLength: 3 }), state('A new Z')]
    const result = await insertion.insertText('new', { addTrailingSpace: false })
    assert.equal(result.ok, true); assert.equal(result.verification, 'verified'); assert.equal(calls, 1)
  })
  await test('unchanged input after native zero is unknown, with no repeated paste or clipboard overwrite', async () => {
    const result = await insertion.insertText('hello', { addTrailingSpace: false })
    assert.equal(result.ok, false); assert.equal(result.verification, 'unknown'); assert.equal(calls, 1); assert.equal(clipboard.length, 0)
  })
  await test('same-length wrong text is not a successful insertion', async () => {
    reads = [state('before'), state('xxxxxx')]
    const result = await insertion.insertText('word', { addTrailingSpace: false })
    assert.equal(result.ok, false); assert.equal(result.verification, 'unknown'); assert.equal(calls, 1)
  })
  await test('focus changes during dispatch do not retry into the new target', async () => {
    reads = [state(''), state('hello', { targetId: 'different-editor' })]
    const result = await insertion.insertText('hello', { addTrailingSpace: false })
    assert.equal(result.verification, 'unknown'); assert.equal(result.error, 'target-changed'); assert.equal(calls, 1)
  })
  await test('opaque input may be attempted but never reported as verified', async () => {
    reads = [null]
    const result = await insertion.insertText('hello')
    assert.equal(result.verification, 'unknown'); assert.equal(result.ok, false); assert.equal(calls, 1); assert.equal(clipboard.length, 0)
  })
  await test('secure input and IME composition block dispatch and clipboard writes', async () => {
    for (const flag of ['secureInput', 'hasMarkedText']) {
      reads = [state('private', { [flag]: true })]
      const result = await insertion.insertText('hello')
      assert.equal(result.verification, 'blocked'); assert.equal(calls, 0); assert.equal(clipboard.length, 0)
    }
  })
  await test('cancellation before dispatch has no side effects', async () => {
    const result = await insertion.insertText('hello', { isCancelled: () => true })
    assert.equal(result.ok, false); assert.equal(calls, 0); assert.equal(clipboard.length, 0)
  })
  await test('cancellation after dispatch never triggers another paste or clipboard write', async () => {
    let cancelled = false
    insertHook = () => { cancelled = true }
    const result = await insertion.insertText('hello', { isCancelled: () => cancelled })
    assert.equal(result.ok, false); assert.equal(calls, 1); assert.equal(clipboard.length, 0)
  })
  await test('unavailable native helper uses a clearly labelled manual clipboard fallback', async () => {
    native.available = false
    const result = await insertion.insertText('hello', { addTrailingSpace: false })
    assert.equal(result.method, 'clipboard'); assert.equal(result.verification, 'not-attempted'); assert.equal(calls, 0); assert.equal(clipboard[0], 'hello')
  })
  await test('Unicode selection positions and trailing space are verified against the actual payload', async () => {
    reads = [state('🙂 old!', { caretLocation: 3, selectionLength: 3 }), state('🙂 new !')]
    const result = await insertion.insertText('new')
    assert.equal(result.verification, 'verified'); assert.equal(calls, 1)
  })
  await test('rich text uses the same plain-text verification instead of trusting return zero', async () => {
    reads = [state(''), state('hello')]
    const result = await insertion.insertRichText('<b>hello</b>', 'hello')
    assert.equal(result.verification, 'verified'); assert.equal(calls, 1)
  })
  await test('only explicit pre-dispatch native failure permits manual clipboard delivery', async () => {
    code = -2
    const result = await insertion.insertText('hello', { addTrailingSpace: false })
    assert.equal(result.verification, 'not-attempted'); assert.equal(result.method, 'clipboard')
    assert.equal(calls, 1); assert.equal(clipboard[0], 'hello')
  })
  await test('native secure and IME guards remain blocked if they change after the first snapshot', async () => {
    for (const errorCode of [-3, -4]) {
      code = errorCode
      const result = await insertion.insertText('hello')
      assert.equal(result.verification, 'blocked'); assert.equal(clipboard.length, 0)
    }
    assert.equal(calls, 2)
  })
  await test('a native exception after possible dispatch does not repeat or overwrite the clipboard', async () => {
    insertHook = () => { throw new Error('uncertain native error') }
    const result = await insertion.insertText('hello')
    assert.equal(result.verification, 'unknown'); assert.equal(result.error, 'native-dispatch-error')
    assert.equal(calls, 1); assert.equal(clipboard.length, 0)
  })
  console.log(`Insertion verification: ${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })
