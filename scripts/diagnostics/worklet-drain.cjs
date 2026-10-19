// Real worklet module, fake message port; validates the final partial block and ACK ordering.
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
let Processor
const messages = []
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../src/renderer/public/capture-worklet.js'), 'utf8'), {
  AudioWorkletProcessor: class { port = { postMessage: value => messages.push(value) } },
  Float32Array,
  registerProcessor: (_name, implementation) => { Processor = implementation }
})
const processor = new Processor({ processorOptions: { chunkSize: 2048 } })
for (let i = 0; i < 17; i++) processor.process([[new Float32Array(128).fill(i)]])
assert.equal(messages.length, 1)
assert.equal(messages[0].length, 2048)
processor.port.onmessage({ data: { type: 'drain' } })
assert.equal(messages.length, 3)
assert.equal(messages[1].length, 128)
assert.ok(messages[1].every(value => value === 16))
assert.equal(messages[2].type, 'drained')
processor.process([[new Float32Array(128)]])
assert.equal(messages.length, 3)
console.log('PASS worklet flushes final 128 samples before drained ACK and ignores later audio')
