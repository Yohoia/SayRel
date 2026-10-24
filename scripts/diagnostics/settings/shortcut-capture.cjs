const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const ts = require('typescript'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../../..')
const file = 'src/renderer/shared/shortcutCapture.ts'
const moduleExports = {}
const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
vm.runInNewContext(source, { exports: moduleExports, require, window: undefined, console, Promise, Set, Map, Object, Array, Number, String })
const { startShortcutCapture } = moduleExports
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function fixture(begin) {
  const calls = [], listeners = new Map(), targetListeners = new Map()
  const bridge = {
    on(channel, callback) {
      calls.push(['subscribe', channel])
      const values = listeners.get(channel) ?? new Set(); values.add(callback); listeners.set(channel, values)
      return () => values.delete(callback)
    },
    invoke(channel, ...args) {
      calls.push([channel, ...args])
      if (channel === 'keyboard:begin-shortcut-capture') return begin()
      return Promise.resolve(true)
    }
  }
  const target = {
    addEventListener(type, callback) { const values = targetListeners.get(type) ?? new Set(); values.add(callback); targetListeners.set(type, values) },
    removeEventListener(type, callback) { targetListeners.get(type)?.delete(callback) },
    emit(type, event) { for (const callback of targetListeners.get(type) ?? []) callback(event) }
  }
  return {
    bridge, target, calls, listeners, targetListeners,
    emit(channel, value) { for (const callback of listeners.get(channel) ?? []) callback(value) }
  }
}
function key(key, patch = {}) {
  return { key, code: patch.code ?? `Key${key.toUpperCase()}`, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
    getModifierState(name) { return name === 'Fn' ? Boolean(patch.fnKey) : false },
    preventDefault() { this.prevented = true }, stopPropagation() { this.stopped = true }, ...patch }
}
async function test(name, fn) { await fn(); console.log('PASS ' + name) }

;(async () => {
  await test('subscribes before starting and delivers native events received before readiness', async () => {
    const pending = deferred(), f = fixture(() => pending.promise), events = []
    const session = startShortcutCapture({ bridge: f.bridge, onEvent: event => events.push(event), target: f.target })
    assert.deepEqual(f.calls.map(call => call[0]), ['subscribe', 'keyboard:begin-shortcut-capture'])
    f.emit('keyboard:shortcut-captured', { sessionId: 21, combination: 'Fn+RightShift', pressed: true })
    assert.equal(events.length, 0, 'events wait until the adapter is ready')
    pending.resolve({ native: true, sessionId: 21 })
    const adapter = await session.ready
    assert.equal(adapter.kind, 'native'); assert.equal(adapter.sessionId, 21)
    assert.equal(JSON.stringify(events), JSON.stringify([{ type: 'shortcut', combination: 'Fn+RightShift', pressed: true }]))
    await session.stop()
    await session.stop()
    f.emit('keyboard:shortcut-captured', { sessionId: 21, combination: 'Fn+RightShift', pressed: false })
    assert.equal(events.length, 1, 'events after release are ignored')
    assert.deepEqual(f.calls.at(-1), ['keyboard:end-shortcut-capture', 21])
    assert.equal(f.calls.filter(call => call[0] === 'keyboard:end-shortcut-capture').length, 1, 'repeated stop releases once')
  })

  await test('browser adapter emits the same shortcut representation and removes listeners', async () => {
    const f = fixture(() => Promise.resolve({ native: false, sessionId: 22 })), events = []
    const session = startShortcutCapture({ bridge: f.bridge, onEvent: event => events.push(event), target: f.target })
    await session.ready
    f.target.emit('keydown', key('Control', { key: 'Control', code: 'ControlLeft', ctrlKey: true }))
    f.target.emit('keydown', key('k', { ctrlKey: true }))
    f.target.emit('keyup', key('k', { ctrlKey: true }))
    f.target.emit('keydown', key('Escape', { code: 'Escape' }))
    assert.equal(JSON.stringify(events), JSON.stringify([
      { type: 'shortcut', combination: 'Control', pressed: true },
      { type: 'shortcut', combination: 'Control+K', pressed: true },
      { type: 'shortcut', combination: 'Control+K', pressed: false },
      { type: 'cancel' }
    ]))
    assert.ok(f.targetListeners.get('keydown').size > 0)
    await session.stop()
    assert.equal(f.targetListeners.get('keydown').size, 0)
    assert.equal(f.targetListeners.get('keyup').size, 0)
  })

  await test('browser capture preserves Shift held before capture when another modifier is pressed', async () => {
    for (const { modifier, code, flag, combination } of [
      { modifier: 'Alt', code: 'AltLeft', flag: 'altKey', combination: 'Alt+Shift' },
      { modifier: 'Control', code: 'ControlLeft', flag: 'ctrlKey', combination: 'Control+Shift' },
      { modifier: 'Meta', code: 'MetaLeft', flag: 'metaKey', combination: 'Command+Shift' },
      { modifier: 'Fn', code: 'Fn', flag: 'fnKey', combination: 'Shift+Fn' }
    ]) {
      const f = fixture(() => Promise.resolve({ native: false, sessionId: 26 })), events = []
      const session = startShortcutCapture({ bridge: f.bridge, onEvent: event => events.push(event), target: f.target })
      await session.ready
      try {
        f.target.emit('keydown', key(modifier, { code, shiftKey: true, [flag]: true }))
        f.target.emit('keyup', key(modifier, { code, shiftKey: true }))
        assert.equal(JSON.stringify(events), JSON.stringify([
          { type: 'shortcut', combination, pressed: true },
          { type: 'shortcut', combination, pressed: false }
        ]), `${modifier} preserves Shift without receiving its keydown`)
      } finally { await session.stop() }
    }
  })

  await test('browser capture retains observed left and right Shift in modifier chords', async () => {
    for (const [code, shift] of [['ShiftLeft', 'LeftShift'], ['ShiftRight', 'RightShift']]) {
      const f = fixture(() => Promise.resolve({ native: false, sessionId: 27 })), events = []
      const session = startShortcutCapture({ bridge: f.bridge, onEvent: event => events.push(event), target: f.target })
      await session.ready
      try {
        f.target.emit('keydown', key('Shift', { code, shiftKey: true }))
        f.target.emit('keydown', key('Alt', { code: 'AltLeft', altKey: true, shiftKey: true }))
        f.target.emit('keyup', key('Alt', { code: 'AltLeft', shiftKey: true }))
        f.target.emit('keyup', key('Shift', { code }))
        assert.equal(JSON.stringify(events), JSON.stringify([
          { type: 'shortcut', combination: shift, pressed: true },
          { type: 'shortcut', combination: `Alt+${shift}`, pressed: true },
          { type: 'shortcut', combination: `Alt+${shift}`, pressed: false },
          { type: 'shortcut', combination: shift, pressed: false }
        ]))
      } finally { await session.stop() }
    }
  })

  await test('exit during initialization ends the late session without delivering late events', async () => {
    const pending = deferred(), f = fixture(() => pending.promise), events = []
    const session = startShortcutCapture({ bridge: f.bridge, onEvent: event => events.push(event), target: f.target })
    const stopping = session.stop()
    f.emit('keyboard:shortcut-captured', { sessionId: 23, combination: 'Control+X', pressed: true })
    pending.resolve({ native: true, sessionId: 23 })
    await stopping
    f.emit('keyboard:shortcut-captured', { sessionId: 23, combination: 'Control+X', pressed: false })
    assert.equal(JSON.stringify(events), '[]')
    assert.deepEqual(f.calls.at(-1), ['keyboard:end-shortcut-capture', 23])
  })

  await test('stop from an older session only releases its own session id', async () => {
    const first = deferred(), second = deferred(), plans = [first, second]
    const f = fixture(() => plans.shift().promise), oldEvents = [], newEvents = []
    const oldSession = startShortcutCapture({ bridge: f.bridge, onEvent: event => oldEvents.push(event), target: f.target })
    const oldStop = oldSession.stop()
    const newSession = startShortcutCapture({ bridge: f.bridge, onEvent: event => newEvents.push(event), target: f.target })
    first.resolve({ native: true, sessionId: 24 })
    second.resolve({ native: true, sessionId: 25 })
    await Promise.all([oldStop, newSession.ready])
    f.emit('keyboard:shortcut-captured', { sessionId: 25, combination: 'Fn', pressed: true })
    assert.equal(JSON.stringify(oldEvents), '[]')
    assert.equal(JSON.stringify(newEvents), JSON.stringify([{ type: 'shortcut', combination: 'Fn', pressed: true }]))
    assert.ok(f.calls.some(call => call[0] === 'keyboard:end-shortcut-capture' && call[1] === 24))
    await newSession.stop()
    assert.ok(f.calls.some(call => call[0] === 'keyboard:end-shortcut-capture' && call[1] === 25))
  })
})().catch(error => { console.error(error); process.exitCode = 1 })
