const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { randomUUID } = require('node:crypto')

const root = path.resolve(__dirname, '../../..'), cache = new Map(), intervals = new Set()
let now = 10000, enabled = true, snapshot = null, keyListener = null, reads = 0
const entries = [], events = [], history = new Map()
class ClockDate extends Date { static now() { return now } }
const mocks = {
  '../lib/settings': { settings: { get: () => ({ dictionaryLearning: enabled, historyEnabled: true }) } },
  './insertion': { readInputState() { reads++; return snapshot } },
  '../windows': { broadcast: (...event) => events.push(event) },
  '../lib/native': { keyboard: { onKey(listener) { keyListener = listener; return () => { keyListener = null } } } },
  './history': { getHistory: id => history.get(id), upsertHistory: row => history.set(row.id, { ...history.get(row.id), ...row }) },
  './dictionary': {
    listDictionary: () => entries,
    addWord(input) { const entry = { ...input, id: randomUUID() }; entries.push(entry); return entry },
    removeWord(id) { const index = entries.findIndex(entry => entry.id === id); if (index >= 0) entries.splice(index, 1) }
  }
}
function load(file) {
  const absolute = path.resolve(root, file.endsWith('.ts') ? file : file + '.ts')
  if (cache.has(absolute)) return cache.get(absolute)
  const exports = {}; cache.set(absolute, exports)
  const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  vm.runInNewContext(code, {
    exports, require: id => mocks[id] ?? (id.startsWith('.') ? load(path.resolve(path.dirname(absolute), id)) : require(id)),
    Date: ClockDate,
    setInterval(callback) { const timer = { callback, unref() {} }; intervals.add(timer); return timer },
    clearInterval(timer) { intervals.delete(timer) },
    setTimeout() { return { unref() {} } }, clearTimeout() {}
  }, { filename: absolute })
  return exports
}
const { inputSnapshotSchema, dictatedRegion, correctedWords } = load('src/shared/editLearning.ts')
const learning = load('src/main/services/dictionaryLearning.ts')
const state = (value, extra = {}) => ({ targetId: 'target-one', hasFocus: true, secureInput: false, value, caretLocation: value.length, selectionLength: 0, hasMarkedText: false, ...extra })
let checks = 0
function test(name, run) { learning.clearDictionaryLearning(); entries.length = 0; enabled = true; snapshot = null; reads = 0; run(); checks++; console.log('PASS ' + name) }
function tick(ms = 250) { now += ms; for (const timer of [...intervals]) timer.callback() }
const inserted = 'Please ask Alex to review Say real before the meeting.'
const edited = 'Please ask Alex to review Sayrel before the meeting.'
function begin(requestId = randomUUID()) {
  const before = inputSnapshotSchema.parse(state(''))
  learning.trackInsertedDictation({ requestId, before, inserted, asrText: inserted, historyId: null })
  snapshot = state(inserted); tick()
  return requestId
}
function edit() { snapshot = state(edited); tick(); tick(1600) }

test('only the dictated region is extracted, including replacement of a selection', () => {
  const before = inputSnapshotSchema.parse(state('Header OLD Footer', { caretLocation: 7, selectionLength: 3 }))
  assert.equal(dictatedRegion(before, inputSnapshotSchema.parse(state('Header new words Footer'))), 'new words')
  assert.equal(dictatedRegion(before, inputSnapshotSchema.parse(state('Other new words Footer'))), null)
  assert.equal(dictatedRegion(before, inputSnapshotSchema.parse(state('Header new words Footer', { targetId: 'other' }))), null)
  assert.equal(dictatedRegion(before, inputSnapshotSchema.parse(state('Header ' + 'x'.repeat(1001) + ' Footer'))), null)
})
test('UTF-16 caret positions correctly isolate text after emoji', () => {
  const before = inputSnapshotSchema.parse(state('🙂 end', { caretLocation: 2 }))
  assert.equal(dictatedRegion(before, inputSnapshotSchema.parse(state('🙂Sayrel end'))), 'Sayrel')
})
test('small term replacements produce candidates, while rewrites and private-looking strings do not', () => {
  assert.equal(correctedWords(inserted, edited).join(','), 'Sayrel')
  assert.equal(correctedWords('请让小张检查一下赛瑞尔的设置并在下午之前给我回复。', '请让小张检查一下Sayrel的设置并在下午之前给我回复。').join(','), 'Sayrel')
  for (const value of ['', inserted, 'Completely different message', inserted.replace('Say real', '123456'), inserted.replace('Say real', 'alex@example.com')]) assert.equal(correctedWords(inserted, value).length, 0)
  assert.equal(correctedWords('x'.repeat(1001), 'y'.repeat(1001)).length, 0)
})
test('learning is opt-in and old or secure native snapshots are rejected', () => {
  enabled = false; assert.equal(learning.captureLearningSnapshot(), null); assert.equal(reads, 0)
  enabled = true
  for (snapshot of [state('secret', { secureInput: true }), state('拼音', { hasMarkedText: true }), { hasFocus: true, caretLocation: 0 }]) assert.equal(learning.captureLearningSnapshot(), null)
})
test('stable corrections only suggest words; confirmation adds once and can be undone', () => {
  begin(); edit()
  const suggestions = learning.listWordSuggestions(); assert.equal(suggestions.length, 1)
  assert.equal(suggestions[0].word, 'Sayrel'); assert.equal(entries.length, 0)
  const result = learning.acceptWordSuggestion(suggestions[0].id)
  assert.equal(result.canUndo, true); assert.equal(entries[0].source, 'auto')
  assert.throws(() => learning.acceptWordSuggestion(suggestions[0].id), /expired/)
  learning.undoLearnedWord(result.entry.id); assert.equal(entries.length, 0)
})
test('undo cannot remove a subsequently edited word and expires after five seconds', () => {
  begin(); edit()
  const first = learning.acceptWordSuggestion(learning.listWordSuggestions()[0].id)
  entries[0].word = 'Edited manually'; learning.undoLearnedWord(first.entry.id)
  assert.equal(entries[0].word, 'Edited manually')
  entries.length = 0; begin(); edit()
  const second = learning.acceptWordSuggestion(learning.listWordSuggestions()[0].id)
  now += 5001; assert.throws(() => learning.undoLearnedWord(second.entry.id), /expired/)
  assert.equal(entries.length, 1)
})
test('Enter checks a correction before the send clears the input', () => {
  begin(); snapshot = state(edited)
  keyListener({ key: 'Return', pressed: true })
  assert.equal(learning.listWordSuggestions().length, 1)
  assert.equal(intervals.size, 0)
})
test('focus changes and IME composition stop tracking without learning', () => {
  for (const extra of [{ targetId: 'other' }, { hasMarkedText: true }, { secureInput: true }]) {
    begin(); snapshot = state(edited, extra); tick(); tick(2000)
    assert.equal(learning.listWordSuggestions().length, 0); assert.equal(intervals.size, 0)
  }
})
test('processed request IDs are deduplicated; disabling learning clears pending text', () => {
  const requestId = begin(); edit(); assert.equal(learning.listWordSuggestions().length, 1)
  begin(requestId); assert.equal(intervals.size, 0)
  enabled = false; assert.equal(learning.listWordSuggestions().length, 0)
  const readCount = reads; tick(2000); assert.equal(reads, readCount)
})
test('tracking times out without reading or saving an unrelated later edit', () => {
  begin(); const readCount = reads
  snapshot = state(edited); tick(15001)
  assert.equal(reads, readCount); assert.equal(learning.listWordSuggestions().length, 0)
})
test('history stores only the bounded edited dictation and retains ASR metadata', () => {
  const id = randomUUID(), before = inputSnapshotSchema.parse(state('Header ', { caretLocation: 7 }))
  history.set(id, { id, modeMeta: JSON.stringify({ transcript: inserted, asr: { kind: 'final' } }) })
  learning.trackInsertedDictation({ requestId: randomUUID(), before, inserted, asrText: inserted, historyId: id })
  snapshot = state('Header ' + inserted); tick()
  snapshot = state('Header ' + edited); tick(); tick(1600)
  const meta = JSON.parse(history.get(id).modeMeta)
  assert.equal(meta.finalEditedText, edited); assert.equal(meta.asr.kind, 'final'); assert(!meta.finalEditedText.includes('Header'))
})
learning.clearDictionaryLearning()
console.log(`PASS Edit learning: ${checks} local privacy, boundary, confirmation, deduplication and undo scenarios`)
