import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer, type IncomingMessage } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'
import { mock } from 'node:test'
import { gzipSync, gunzipSync } from 'node:zlib'
import { WebSocketServer, type WebSocket } from 'ws'
import { z } from 'zod'
import { providerProfileSchema, type ProviderProfile } from '../../../src/shared/providers'
import type { TranscriptionRequest } from '../../../src/shared/types'
import { transcribeRealtime } from '../../../src/main/services/providers/realtime'

const localKey = 'local-fixture-key'
const request = { pcm: new Float32Array(7200).fill(0.25), sampleRate: 16000, durationMs: 450, mode: 'voice_transcript', language: 'zh', dictionary: ['Sayrel'] } satisfies TranscriptionRequest
const object = z.record(z.string(), z.unknown())
function json(data: Buffer) { return object.parse(JSON.parse(data.toString())) }
function profile(protocol: ProviderProfile['protocol'], endpoint: string): ProviderProfile {
  return providerProfileSchema.parse({ id: 'fixture', presetId: '', name: 'Fixture', enabled: true, endpoint, apiKey: localKey,
    service: 'transcription', protocol, models: ['fixture'], appId: '', accessToken: '', resourceId: 'volc.test.resource', apiVersion: '' })
}
type Frame = { data: Buffer; binary: boolean; at: number }
type Handler = (socket: WebSocket, request: IncomingMessage, frames: Frame[]) => void
async function fixture<T>(handler: Handler, run: (url: string, frames: Frame[]) => Promise<T>): Promise<T> {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  const frames: Frame[] = [], failures: unknown[] = []
  server.on('connection', (socket, req) => {
    socket.on('message', (data, binary) => {
      if (!Buffer.isBuffer(data)) { failures.push(new Error('Fixture received unexpected fragment type')); return }
      frames.push({ data, binary, at: performance.now() })
    })
    try { handler(socket, req, frames) } catch (error) { failures.push(error); socket.terminate() }
  })
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address !== 'string')
  try {
    const result = await run(`ws://127.0.0.1:${address.port}`, frames)
    assert.deepEqual(failures, [])
    return result
  } finally {
    for (const client of server.clients) client.terminate()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}
function handleMessages(socket: WebSocket, listener: (data: Buffer, binary: boolean) => void) {
  socket.on('message', (data, binary) => {
    assert(Buffer.isBuffer(data))
    listener(data, binary)
  })
}
function send(socket: WebSocket, event: object) { socket.send(JSON.stringify(event)) }
function volcReply(payload: object, final: boolean): Buffer {
  const data = gzipSync(Buffer.from(JSON.stringify(payload))), packet = Buffer.alloc(12)
  packet[0] = 0x11; packet[1] = final ? 0x93 : 0x91; packet[2] = 0x11
  packet.writeInt32BE(final ? -3 : 1, 4); packet.writeUInt32BE(data.length, 8)
  return Buffer.concat([packet, data])
}
let checks = 0

await fixture((socket, req) => {
  assert.equal(req.headers.authorization, `Bearer ${localKey}`)
  assert.match(req.url ?? '', /model=qwen3-asr-flash-realtime/)
  let ready = false, committed = false
  handleMessages(socket, data => {
    const event = json(data)
    if (event.type === 'session.update') {
      assert.deepEqual(event.session, { input_audio_format: 'pcm', sample_rate: 16000, input_audio_transcription: { language: 'zh' }, turn_detection: null })
      setTimeout(() => { ready = true; send(socket, { type: 'session.updated' }) }, 25)
    } else if (event.type === 'input_audio_buffer.append') assert(ready)
    else if (event.type === 'input_audio_buffer.commit') { committed = true; send(socket, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'one', transcript: '你好' }) }
    else if (event.type === 'session.finish') { assert(committed); send(socket, { type: 'session.finished' }) }
    else assert.fail('Unexpected Qwen client event')
  })
}, async (url, frames) => {
  const result = await transcribeRealtime(profile('qwen-asr', url), 'qwen3-asr-flash-realtime', { ...request, pcm: new Float32Array(21600).fill(0.25), sampleRate: 48000 })
  assert.equal(result.text, '你好')
  const audio = frames.filter(frame => json(frame.data).type === 'input_audio_buffer.append')
  const chunks = audio.map(frame => Buffer.from(z.string().parse(json(frame.data).audio), 'base64'))
  assert.deepEqual(chunks.map(chunk => chunk.length), [6400, 6400, 1600])
  assert.equal(chunks[0].readInt16LE(0), 8192)
  assert(audio[1].at - audio[0].at >= 150)
  assert.deepEqual(frames.slice(-2).map(frame => json(frame.data).type), ['input_audio_buffer.commit', 'session.finish'])
}); checks++

await fixture((socket, req) => {
  assert.equal(req.url, '/api-ws/v1/inference')
  let taskId: unknown, ready = false
  handleMessages(socket, (data, binary) => {
    if (binary) { assert(ready); return }
    const event = z.object({ header: z.object({ action: z.string(), task_id: z.string(), streaming: z.literal('duplex') }), payload: object }).parse(json(data))
    if (event.header.action === 'run-task') {
      taskId = event.header.task_id
      assert.deepEqual(event.payload.parameters, { format: 'pcm', sample_rate: 16000, language_hints: ['zh'] })
      setTimeout(() => { ready = true; send(socket, { header: { event: 'task-started' } }) }, 20)
    } else {
      assert.equal(event.header.action, 'finish-task'); assert.equal(event.header.task_id, taskId)
      for (const [sentence_id, text, sentence_end] of [[2, '世界', true], [1, '错误中间结果', false], [1, '你好', true]] satisfies [number, string, boolean][]) send(socket, { header: { event: 'result-generated' }, payload: { output: { sentence: { sentence_id, text, sentence_end } } } })
      send(socket, { header: { event: 'task-finished' } })
    }
  })
}, async (url, frames) => {
  assert.equal((await transcribeRealtime(profile('qwen-asr', `${url}/api-ws/v1/realtime`), 'fun-asr-realtime', request)).text, '你好世界')
  assert.equal(frames.filter(frame => frame.binary).reduce((sum, frame) => sum + frame.data.length, 0), 14400)
}); checks++

await fixture((socket, req) => {
  assert.equal(req.headers.authorization, `Bearer ${localKey}`)
  let configured = false
  handleMessages(socket, (data, binary) => {
    if (binary) { assert(configured); return }
    if (data.length) {
      const event = json(data); assert.equal(event.api_key, localKey); assert.equal(event.audio_format, 'pcm_s16le'); assert.equal(event.sample_rate, 16000)
      assert.deepEqual(event.context, { terms: ['Sayrel'] }); configured = true
    } else {
      send(socket, { tokens: [{ text: 'temporary', is_final: false }, { text: '你好', is_final: true, language: 'zh' }, { text: '<end>', is_final: true }] })
      send(socket, { tokens: [{ text: 'translated', is_final: true, translation_status: 'translation' }, { text: '世界', is_final: true }] })
      send(socket, { tokens: [], finished: true })
    }
  })
}, async url => {
  const result = await transcribeRealtime(profile('soniox', url), 'stt-rt-v5', request)
  assert.equal(result.text, '你好世界'); assert.equal(result.detectedLanguage, 'zh')
}); checks++

await fixture((socket, req) => {
  assert.equal(req.headers['xi-api-key'], localKey)
  assert.match(req.url ?? '', /model_id=scribe_v2_realtime/); assert.match(req.url ?? '', /commit_strategy=manual/)
  assert(!(req.url ?? '').includes(localKey))
  let ready = false
  setTimeout(() => { ready = true; send(socket, { message_type: 'session_started' }) }, 20)
  handleMessages(socket, data => {
    assert(ready)
    const event = json(data); assert.equal(event.message_type, 'input_audio_chunk'); assert.equal(event.sample_rate, 16000)
    if (event.commit) { assert.equal(event.audio_base_64, ''); send(socket, { message_type: 'committed_transcript', text: 'scribe result' }) }
    else send(socket, { message_type: 'partial_transcript', text: 'unstable' })
  })
}, async url => { assert.equal((await transcribeRealtime(profile('elevenlabs', url), 'scribe_v2_realtime', request)).text, 'scribe result') }); checks++

await fixture((socket, req) => {
  assert.match(req.url ?? '', /intent=transcription/)
  handleMessages(socket, data => {
    const event = json(data)
    if (event.type === 'session.update') {
      assert.deepEqual(event.session, { type: 'transcription', audio: { input: { format: { type: 'audio/pcm', rate: 24000 }, transcription: { model: 'gpt-realtime-whisper', language: 'zh' }, turn_detection: null } } })
      send(socket, { type: 'session.updated' })
    } else if (event.type === 'input_audio_buffer.commit') send(socket, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'one', transcript: 'openai result', languages: [{ code: 'zh' }] })
  })
}, async (url, frames) => {
  const result = await transcribeRealtime(profile('openai-realtime', url), 'gpt-realtime-whisper', request)
  assert.equal(result.text, 'openai result'); assert.equal(result.detectedLanguage, 'zh')
  const bytes = frames.filter(frame => json(frame.data).type === 'input_audio_buffer.append').reduce((sum, frame) => sum + Buffer.from(z.string().parse(json(frame.data).audio), 'base64').length, 0)
  assert.equal(bytes, 21600)
}); checks++

for (const legacy of [false, true]) {
  await fixture((socket, req) => {
    assert.equal(req.headers['x-api-resource-id'], 'volc.test.resource')
    assert(req.headers['x-api-connect-id']); assert(req.headers['x-api-request-id'])
    if (legacy) { assert.equal(req.headers['x-api-app-key'], 'fixture-app'); assert.equal(req.headers['x-api-access-key'], 'fixture-token'); assert.equal(req.headers['x-api-key'], undefined) }
    else assert.equal(req.headers['x-api-key'], localKey)
    let expectedSequence = 1, configured = false
    handleMessages(socket, (data, binary) => {
      assert(binary); assert.equal(data[0], 0x11); assert.equal(data.readUInt32BE(8), data.length - 12)
      const sequence = data.readInt32BE(4), final = Boolean(data[1] & 2), payload = gunzipSync(data.subarray(12))
      assert.equal(Math.abs(sequence), expectedSequence++)
      if (data[1] >> 4 === 1) {
        assert.equal(sequence, 1); const config = json(payload)
        assert.deepEqual(config.audio, { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1 })
        assert.equal(object.parse(config.request).model_name, 'bigmodel')
        configured = true; socket.send(volcReply({}, false))
      } else {
        assert(configured); assert.equal(data[2], 0x01)
        if (final) { assert(sequence < 0); socket.send(volcReply({ result: { text: '火山转写' } }, true)) }
        else socket.send(volcReply({ result: { text: '中间结果' } }, false))
      }
    })
  }, async url => {
    const selected = profile('volcengine-asr', url)
    assert.equal((await transcribeRealtime(legacy ? { ...selected, apiKey: '', appId: 'fixture-app', accessToken: 'fixture-token' } : selected, 'bigmodel_nostream', request)).text, '火山转写')
  }); checks++
}

await fixture((socket, req) => {
  assert.equal(req.url, '/api/v3/sauc/bigmodel_async')
  let configured = false
  handleMessages(socket, (data, binary) => {
    assert(binary)
    if (data[1] >> 4 === 1) { configured = true; return }
    assert(configured)
    // The optimized endpoint does not acknowledge configuration before audio.
    if (data[1] & 2) socket.send(volcReply({ result: [{ text: 'async result' }] }, true))
  })
}, async url => {
  assert.equal((await transcribeRealtime(profile('volcengine-asr', `${url}/api/v3/sauc/bigmodel_nostream`), 'bigmodel_async', request)).text, 'async result')
}); checks++

const qwenBatchRequests: { path: string; body: unknown }[] = []
let batchFinishReason = 'stop'
let holdBatchResponse = false
const qwenBatchServer = createServer(async (req, res) => {
  assert.equal(req.headers.authorization, `Bearer ${localKey}`)
  assert.equal(req.headers['x-dashscope-sse'], 'disable')
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  qwenBatchRequests.push({ path: req.url ?? '', body: JSON.parse(Buffer.concat(chunks).toString()) })
  if (holdBatchResponse) return
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ output: { choices: [{ finish_reason: batchFinishReason, message: { content: [{ text: '批量转写' }], annotations: [{ type: 'audio_info', language: 'zh' }] } }] } }))
})
qwenBatchServer.listen(0, '127.0.0.1'); await once(qwenBatchServer, 'listening')
const batchAddress = qwenBatchServer.address(); assert(batchAddress && typeof batchAddress !== 'string')
try {
  for (const path of ['/api-ws/v1/realtime', '/proxy/api-ws/v1/realtime?route=one', '/api/v1/services/aigc/multimodal-generation/generation']) {
    const selected = profile('qwen-asr', `ws://127.0.0.1:${batchAddress.port}${path}`)
    const started = performance.now()
    const result = await transcribeRealtime(selected, 'qwen3-asr-flash', { ...request, pcm: new Float32Array(16000 * 3).fill(0.25), durationMs: 3000, signal: AbortSignal.timeout(1000) })
    assert.equal(result.text, '批量转写'); assert.equal(result.detectedLanguage, 'zh')
    assert(performance.now() - started < 1000, 'a prerecorded 3-second clip must not be replayed for 3 seconds')
    const last = qwenBatchRequests.at(-1); assert(last)
    assert.equal(last.path, path.startsWith('/proxy/') ? '/proxy/api/v1/services/aigc/multimodal-generation/generation?route=one' : '/api/v1/services/aigc/multimodal-generation/generation')
    const body = z.object({ model: z.literal('qwen3-asr-flash'), input: z.object({ messages: z.array(z.object({ role: z.literal('user'), content: z.array(z.object({ audio: z.string() })) })) }), parameters: object }).parse(last.body)
    const encoded = body.input.messages[0].content[0].audio
    assert(encoded.startsWith('data:audio/wav;base64,')); assert.equal(Buffer.from(encoded.split(',')[1], 'base64').toString('ascii', 0, 4), 'RIFF')
    assert.deepEqual(body.parameters.asr_options, { language: 'zh', enable_itn: false }); checks++
  }
  batchFinishReason = 'length'
  await assert.rejects(transcribeRealtime(profile('qwen-asr', `ws://127.0.0.1:${batchAddress.port}`), 'qwen3-asr-flash', request), /complete|finish/); checks++
  holdBatchResponse = true
  await assert.rejects(transcribeRealtime(profile('qwen-asr', `ws://127.0.0.1:${batchAddress.port}`), 'qwen3-asr-flash', { ...request, signal: AbortSignal.timeout(30) }), /cancelled/); checks++
} finally { qwenBatchServer.closeAllConnections(); await new Promise<void>(resolve => qwenBatchServer.close(() => resolve())) }

for (const path of ['', '/api/v1', '/api/v1/services/aigc/multimodal-generation/generation', '/proxy/api/v1/services/aigc/multimodal-generation/generation?route=one', '/proxy/api-ws/v1/realtime?route=one']) {
  const controller = new AbortController()
  await fixture((socket, req) => {
    const routed = new URL(req.url ?? '', 'http://fixture.invalid')
    assert.equal(routed.pathname, `${path.startsWith('/proxy/') ? '/proxy' : ''}/api-ws/v1/realtime`)
    assert.equal(routed.searchParams.get('model'), 'qwen3-asr-flash-realtime')
    assert.equal(routed.searchParams.get('route'), path.includes('route=one') ? 'one' : null)
    handleMessages(socket, data => {
      const event = json(data)
      if (event.type === 'session.update') send(socket, { type: 'session.updated' })
      if (event.type === 'input_audio_buffer.append') controller.abort()
    })
  }, async (url, frames) => {
    await assert.rejects(transcribeRealtime(profile('qwen-asr', `${url}${path}`), 'qwen3-asr-flash', { ...request,
      pcm: new Float32Array(16000 * 300), durationMs: 300000, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]) }), /cancelled/)
    assert(frames.some(frame => json(frame.data).type === 'input_audio_buffer.append'), 'five-minute clips retain the streaming route beyond the Base64 batch limit'); checks++
  })
}

const httpServer = createServer(async (req, res) => {
  assert.equal(req.headers.authorization, `Bearer ${localKey}`)
  assert.equal(req.url, '/api/v1/services/aigc/multimodal-generation/generation')
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  const data = z.object({ model: z.literal('fun-asr-flash-2026-06-15'), input: z.object({ messages: z.array(z.object({ content: z.array(z.object({ type: z.literal('input_audio'), input_audio: z.object({ data: z.string() }) })) })) }), parameters: object }).parse(JSON.parse(Buffer.concat(chunks).toString()))
  const encoded = data.input.messages[0].content[0].input_audio.data
  assert(encoded.startsWith('data:audio/wav;base64,')); assert.equal(Buffer.from(encoded.split(',')[1], 'base64').toString('ascii', 0, 4), 'RIFF')
  assert.deepEqual(data.parameters.vocabulary, { Sayrel: 5 })
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ output: { text: 'flash result' } }))
})
httpServer.listen(0, '127.0.0.1'); await once(httpServer, 'listening')
const address = httpServer.address(); assert(address && typeof address !== 'string')
try { assert.equal((await transcribeRealtime(profile('qwen-asr', `ws://127.0.0.1:${address.port}/api-ws/v1/realtime`), 'fun-asr-flash-2026-06-15', request)).text, 'flash result'); checks++ }
finally { await new Promise<void>(resolve => httpServer.close(() => resolve())) }

await fixture(socket => {
  handleMessages(socket, data => {
    const event = json(data)
    if (event.type === 'session.update') send(socket, { type: 'session.updated' })
    if (event.type === 'session.finish') send(socket, { type: 'session.finished' })
  })
}, async url => { assert.equal((await transcribeRealtime(profile('qwen-asr', url), 'qwen3-asr-flash-realtime', request)).text, '') }); checks++

for (const mode of ['malformed', 'server-error', 'early-close', 'early-finished']) {
  await fixture(socket => {
    handleMessages(socket, data => {
      if (json(data).type !== 'session.update') return
      if (mode === 'malformed') socket.send('{invalid')
      if (mode === 'server-error') send(socket, { type: 'error', error: { code: 'authentication_failed', message: localKey } })
      if (mode === 'early-close') { send(socket, { type: 'conversation.item.input_audio_transcription.completed', transcript: 'partial must not succeed' }); socket.close() }
      if (mode === 'early-finished') send(socket, { type: 'session.finished' })
    })
  }, async url => {
    await assert.rejects(transcribeRealtime(profile('qwen-asr', url), 'qwen3-asr-flash-realtime', request), error => error instanceof Error && !error.message.includes(localKey))
  }); checks++
}

for (const mode of ['invalid-length', 'invalid-gzip', 'binary-error']) {
  await fixture(socket => {
    handleMessages(socket, () => {
      if (mode === 'binary-error') {
        const packet = Buffer.alloc(12); packet[0] = 0x11; packet[1] = 0xf0; packet.writeUInt32BE(45000001, 4); socket.send(packet)
      } else {
        const packet = volcReply({}, false)
        if (mode === 'invalid-length') packet.writeUInt32BE(10000, 8)
        else packet.fill(0, 12)
        socket.send(packet)
      }
    })
  }, async url => { await assert.rejects(transcribeRealtime(profile('volcengine-asr', url), 'bigmodel_nostream', request), /protocol|failed/) }); checks++
}

await fixture(socket => {
  handleMessages(socket, data => { if (json(data).type === 'session.update') send(socket, { type: 'session.updated' }) })
}, async (url, frames) => {
  const controller = new AbortController()
  const pending = transcribeRealtime(profile('qwen-asr', url), 'qwen3-asr-flash-realtime', { ...request, signal: controller.signal })
  await sleep(65); controller.abort()
  await assert.rejects(pending, /cancelled/)
  const count = frames.length; await sleep(220); assert.equal(frames.length, count)
}); checks++
for (const mode of ['configuration-timeout', 'result-timeout']) {
  let reachedPhase: () => void = () => {}
  const phase = new Promise<void>(resolve => { reachedPhase = resolve })
  await fixture(socket => {
    handleMessages(socket, data => {
      const event = json(data)
      if (event.type === 'session.update') {
        if (mode === 'configuration-timeout') reachedPhase()
        else send(socket, { type: 'session.updated' })
      }
      if (event.type === 'session.finish') reachedPhase()
    })
  }, async url => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const pending = assert.rejects(transcribeRealtime(profile('qwen-asr', url), 'qwen3-asr-flash-realtime', { ...request, pcm: new Float32Array(3200), durationMs: 200 }), mode === 'configuration-timeout' ? /configuration was not confirmed/ : /timed out/)
      await phase
      mock.timers.tick(60_000)
      await pending
    } finally { mock.timers.reset() }
  }); checks++
}

const controller = new AbortController(); controller.abort()
await assert.rejects(transcribeRealtime(profile('soniox', 'ws://127.0.0.1:1'), 'stt-rt-v5', { ...request, signal: controller.signal }), /cancelled/); checks++
console.log(`Realtime provider diagnostics passed: ${checks} local protocol scenarios`)
