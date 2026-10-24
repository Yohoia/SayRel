import assert from 'node:assert/strict'
import { once } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'
import { mock } from 'node:test'
import { gunzipSync, gzipSync } from 'node:zlib'
import { WebSocketServer, type WebSocket } from 'ws'
import { z } from 'zod'
import { providerProfileSchema, type ProviderProfile } from '../../../src/shared/providers'
import { startLiveTranscription, supportsLiveTranscription } from '../../../src/main/services/providers/realtime'
import { StreamingPcm16 } from '../../../src/main/services/providers/realtimeTransport'

const request = { sampleRate: 16000, durationMs: 0, mode: 'voice_transcript' as const }
const object = z.record(z.string(), z.unknown())
const json = (data: Buffer) => object.parse(JSON.parse(data.toString()))
const send = (socket: WebSocket, event: object) => socket.send(JSON.stringify(event))
const pcm = (size = 1600) => new Float32Array(size).fill(0.25)
let checks = 0
async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000
  while (!predicate()) { assert(Date.now() < deadline, 'local protocol event did not arrive'); await sleep(5) }
}
function profile(protocol: ProviderProfile['protocol'], endpoint: string): ProviderProfile {
  return providerProfileSchema.parse({ id: 'live-fixture', presetId: '', name: 'Live fixture', enabled: true,
    service: 'transcription', protocol, endpoint, apiKey: '', models: ['fixture'], appId: '', accessToken: '', resourceId: '', apiVersion: '' })
}
type Frame = { data: Buffer; binary: boolean }
async function fixture(setup: (socket: WebSocket) => void, run: (url: string, frames: Frame[]) => Promise<void>) {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' }), frames: Frame[] = []
  server.on('connection', socket => {
    socket.on('message', (data, binary) => { assert(Buffer.isBuffer(data)); frames.push({ data, binary }) })
    setup(socket)
  })
  await once(server, 'listening')
  const address = server.address(); assert(address && typeof address !== 'string')
  try { await run(`ws://127.0.0.1:${address.port}`, frames); checks++ }
  finally { for (const socket of server.clients) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())) }
}
function messages(socket: WebSocket, onMessage: (data: Buffer, binary: boolean) => void) {
  socket.on('message', (data, binary) => { assert(Buffer.isBuffer(data)); onMessage(data, binary) })
}

for (const outputRate of [8000, 16000, 24000]) {
  for (const size of [1, 3, 127, 1027, 16000]) {
    const input = Float32Array.from({ length: size }, (_, i) => Math.sin(i * 0.13) * 0.8)
    const whole = new StreamingPcm16(16000, outputRate).encode(input, true)
    const streaming = new StreamingPcm16(16000, outputRate), chunks: Buffer[] = []
    for (let offset = 0; offset < input.length; offset += 127) chunks.push(streaming.encode(input.subarray(offset, offset + 127)))
    chunks.push(streaming.encode(new Float32Array(), true))
    assert.equal(whole.length, Math.round(size * outputRate / 16000) * 2)
    assert.deepEqual(Buffer.concat(chunks), whole, 'chunk boundaries must not duplicate or drop audio samples')
    checks++
  }
}
assert.throws(() => new StreamingPcm16(16000, 16000).encode(new Float32Array([NaN])), /invalid audio/); checks++
assert.equal(supportsLiveTranscription(profile('qwen-asr', 'https://fixture.invalid'), 'qwen3-asr-flash'), false)
assert.equal(supportsLiveTranscription(profile('openai-transcription', 'https://fixture.invalid'), 'whisper-1'), false)
checks += 2

await fixture(socket => {
  messages(socket, data => {
    const event = json(data)
    if (event.type === 'session.update') send(socket, { type: 'session.updated' })
    if (event.type === 'input_audio_buffer.append') send(socket, { type: 'conversation.item.input_audio_transcription.text', text: 'draft' })
    if (event.type === 'input_audio_buffer.commit') send(socket, { type: 'conversation.item.input_audio_transcription.completed', transcript: 'final dictated text' })
    if (event.type === 'session.finish') send(socket, { type: 'session.finished' })
  })
}, async (url, frames) => {
  const partials: string[] = []
  const session = startLiveTranscription(profile('qwen-asr', url), 'qwen3-asr-flash-realtime', request, text => partials.push(text))
  let finalized = false
  void session.result.then(() => { finalized = true }, () => {})
  session.pushPcm(pcm())
  await until(() => partials.includes('draft'))
  assert.equal(finalized, false, 'partial text cannot finalize an active capture')
  assert(frames.some(frame => json(frame.data).type === 'input_audio_buffer.append'), 'audio must reach the server before finish')
  session.pushPcm(pcm(137))
  const final = session.finish()
  assert.equal(session.finish(), final, 'finish is idempotent')
  assert.equal((await final).text, 'final dictated text')
  const appends = frames.filter(frame => json(frame.data).type === 'input_audio_buffer.append')
  assert.equal(appends.reduce((sum, frame) => sum + Buffer.from(z.string().parse(json(frame.data).audio), 'base64').length, 0), 1737 * 2)
  assert.equal(frames.filter(frame => json(frame.data).type === 'input_audio_buffer.commit').length, 1)
})

await fixture(socket => {
  messages(socket, data => {
    const event = json(data)
    if (event.type === 'session.update') send(socket, { type: 'session.updated' })
    if (event.type === 'input_audio_buffer.append') send(socket, { type: 'conversation.item.input_audio_transcription.delta', item_id: 'one', delta: 'hello' })
    if (event.type === 'input_audio_buffer.commit') send(socket, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'one', transcript: 'hello world' })
  })
}, async (url, frames) => {
  const session = startLiveTranscription(profile('openai-realtime', url), 'gpt-4o-mini-transcribe', request, () => {})
  session.pushPcm(pcm(1601))
  await until(() => frames.some(frame => json(frame.data).type === 'input_audio_buffer.append'))
  assert.equal((await session.finish()).text, 'hello world')
  const bytes = frames.filter(frame => json(frame.data).type === 'input_audio_buffer.append').reduce((sum, frame) => sum + Buffer.from(z.string().parse(json(frame.data).audio), 'base64').length, 0)
  assert.equal(bytes, Math.round(1601 * 24000 / 16000) * 2)
})

await fixture(socket => {
  messages(socket, (data, binary) => {
    if (binary) send(socket, { tokens: [{ text: 'hello ', is_final: true }, { text: 'draft', is_final: false }] })
    else if (!data.length) {
      send(socket, { tokens: [{ text: 'world', is_final: true }] })
      send(socket, { tokens: [], finished: true })
    }
  })
}, async url => {
  const partials: string[] = []
  const session = startLiveTranscription(profile('soniox', url), 'stt-rt-v5', request, text => partials.push(text))
  session.pushPcm(pcm())
  await until(() => partials.includes('hello draft'))
  assert.equal((await session.finish()).text, 'hello world')
})

await fixture(socket => {
  setTimeout(() => send(socket, { message_type: 'session_started' }), 15)
  messages(socket, data => {
    const event = json(data)
    if (event.commit === true) send(socket, { message_type: 'committed_transcript', text: 'committed text' })
    else send(socket, { message_type: 'partial_transcript', text: 'draft' })
  })
}, async url => {
  const partials: string[] = []
  const session = startLiveTranscription(profile('elevenlabs', url), 'scribe_v2_realtime', request, text => partials.push(text))
  session.pushPcm(pcm()); await until(() => partials.length > 0)
  assert.equal((await session.finish()).text, 'committed text')
})

await fixture(socket => {
  messages(socket, (data, binary) => {
    if (!binary) {
      const header = z.object({ header: z.object({ action: z.string() }) }).parse(json(data)).header
      if (header.action === 'run-task') send(socket, { header: { event: 'task-started' } })
      else send(socket, { header: { event: 'task-finished' } })
    } else send(socket, { header: { event: 'result-generated' }, payload: { output: { sentence: { sentence_id: 1, text: 'finished sentence', sentence_end: true } } } })
  })
}, async url => {
  const partials: string[] = []
  const session = startLiveTranscription(profile('qwen-asr', url), 'fun-asr-realtime', request, text => partials.push(text))
  session.pushPcm(pcm()); await until(() => partials.length > 0)
  assert.equal((await session.finish()).text, 'finished sentence')
})

function volcReply(text: string, final: boolean) {
  const payload = gzipSync(Buffer.from(JSON.stringify({ result: { text } }))), header = Buffer.alloc(12)
  header[0] = 0x11; header[1] = final ? 0x93 : 0x91; header[2] = 0x11
  header.writeInt32BE(final ? -3 : 1, 4); header.writeUInt32BE(payload.length, 8)
  return Buffer.concat([header, payload])
}
await fixture(socket => {
  messages(socket, data => {
    const type = data[1] >> 4, final = Boolean(data[1] & 2)
    if (type === 1) socket.send(volcReply('', false))
    else socket.send(volcReply(final ? 'complete result' : 'draft', final))
  })
}, async (url, frames) => {
  const partials: string[] = []
  const session = startLiveTranscription(profile('volcengine-asr', url), 'bigmodel', request, text => partials.push(text))
  session.pushPcm(pcm(1703)); await until(() => partials.includes('draft'))
  assert.equal((await session.finish()).text, 'complete result')
  const audio = frames.filter(frame => frame.data[1] >> 4 === 2)
  assert.equal(audio.filter(frame => frame.data[1] & 2).length, 1)
  assert.equal(audio.reduce((sum, frame) => sum + gunzipSync(frame.data.subarray(12)).length, 0), 1703 * 2)
})

for (const failure of ['close', 'early-final', 'malformed', 'abort', 'backlog']) {
  await fixture(socket => {
    messages(socket, data => {
      const event = json(data)
      if (event.type === 'session.update' && failure !== 'backlog') send(socket, { type: 'session.updated' })
      if (event.type === 'input_audio_buffer.append') {
        if (failure === 'close') { send(socket, { type: 'conversation.item.input_audio_transcription.text', text: 'partial only' }); socket.close() }
        if (failure === 'early-final') send(socket, { type: 'session.finished' })
        if (failure === 'malformed') socket.send('{invalid')
      }
    })
  }, async (url, frames) => {
    const session = startLiveTranscription(profile('qwen-asr', url), 'qwen3-asr-flash-realtime', request, () => {})
    session.pushPcm(pcm(failure === 'backlog' ? 16000 * 16 : 1600))
    if (failure === 'abort') {
      await until(() => frames.some(frame => json(frame.data).type === 'input_audio_buffer.append'))
      session.abort()
    }
    await assert.rejects(session.result)
    const count = frames.length
    session.pushPcm(pcm()); await sleep(20)
    assert.equal(frames.length, count, 'settled sessions must not send new audio')
  })
}

await fixture(socket => {
  messages(socket, data => { if (json(data).type === 'session.update') send(socket, { type: 'session.updated' }) })
}, async (url, frames) => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const session = startLiveTranscription(profile('qwen-asr', url), 'qwen3-asr-flash-realtime', request, () => {})
    session.pushPcm(pcm()); await until(() => frames.some(frame => json(frame.data).type === 'input_audio_buffer.append'))
    const result = session.finish(); mock.timers.tick(45001); await assert.rejects(result, /timed out/)
  }
  finally { mock.timers.reset() }
})

console.log(`PASS Live ASR: ${checks} local transport, resampling, pre-stop upload and cancellation scenarios`)
