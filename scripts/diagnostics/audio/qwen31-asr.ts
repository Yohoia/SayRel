import assert from 'node:assert/strict'
import { once } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'
import { WebSocketServer } from 'ws'
import { z } from 'zod'
import { providerProfileSchema } from '../../../src/shared/providers'
import { PROVIDER_PRESETS } from '../../../src/shared/providerPresets'
import { transcribeProfile } from '../../../src/main/services/providers'
import { startLiveTranscription, supportsLiveTranscription } from '../../../src/main/services/providers/realtime'

const models = ['qwen-audio-3.1-asr-flash-message', 'qwen-audio-3.1-asr-flash-streaming']
const request = { durationMs: 200, sampleRate: 16000, pcm: new Float32Array(3200).fill(0.1), mode: 'voice_transcript' as const }
const profile = (endpoint: string) => providerProfileSchema.parse({ id: 'qwen31-fixture', presetId: 'asr-aliyun_qwen', name: 'Fixture',
  service: 'transcription', protocol: 'qwen-asr', enabled: true, endpoint, apiKey: '', models, appId: '', accessToken: '', resourceId: '', apiVersion: '' })
const runSchema = z.object({ header: z.object({ action: z.string(), task_id: z.string() }), payload: z.object({ model: z.string().optional(), parameters: z.record(z.string(), z.unknown()).optional() }) })

for (const model of models) assert(supportsLiveTranscription(profile('https://fixture.invalid'), model), `${model}: recording-time ASR must be supported`)
const preset = PROVIDER_PRESETS.find(preset => preset.id === 'asr-aliyun_qwen')
assert(preset)
for (const model of models) assert(preset.models.includes(model), `${model}: preset must offer the model`)

let checks = 0
for (const model of models) {
  for (const providerPolish of [false, true]) {
    let path = '', taskId = '', audioBytes = 0
    let parameters: Record<string, unknown> = {}
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
    server.on('connection', (socket, incoming) => {
      path = incoming.url ?? ''
      const send = (event: string, sentence?: object) => socket.send(JSON.stringify({ header: { event, task_id: taskId }, payload: sentence ? { output: { sentence } } : {} }))
      socket.on('message', (data, binary) => {
        assert(Buffer.isBuffer(data))
        if (binary) {
          audioBytes += data.length
          send('result-generated', { sentence_id: 1, text: '旧草稿', sentence_end: false })
          send('result-generated', { sentence_id: 1, text: '修订草稿', sentence_end: false })
          send('result-generated', { sentence_id: 0, heartbeat: true })
        } else {
          const message = runSchema.parse(JSON.parse(data.toString()))
          if (message.header.action === 'run-task') {
            taskId = message.header.task_id
            assert.equal(message.payload.model, model)
            parameters = message.payload.parameters ?? {}
            send('task-started')
          } else {
            assert.equal(message.header.action, 'finish-task')
            send('result-generated', { sentence_id: 2, text: '第二句。', sentence_end: true })
            send('result-generated', { sentence_id: 1, text: '最终成稿。', sentence_end: true })
            send('result-generated', { sentence_id: 1, text: '过期草稿', sentence_end: false })
            send('task-finished')
          }
        }
      })
    })
    await once(server, 'listening')
    const address = server.address(); assert(address && typeof address !== 'string')
    const endpoint = `ws://127.0.0.1:${address.port}/api-ws/v1/realtime?model=obsolete`
    try {
      const partials: string[] = []
      const session = startLiveTranscription(profile(endpoint), model, { ...request, providerPolish, dictionary: ['SayRel'], language: 'zh' }, text => partials.push(text))
      session.pushPcm(request.pcm)
      for (let n = 0; n < 200 && !partials.includes('修订草稿'); n++) await sleep(5)
      assert(partials.includes('修订草稿'), 'drafts must arrive before recording stops')
      const result = await session.finish()
      assert.equal(result.text, '最终成稿。第二句。', 'sentence IDs replace drafts and sort finals; late drafts must not replace final text')
      assert.equal(audioBytes, request.pcm.length * 2)
      assert.equal(path, '/api-ws/v1/inference', 'never use HTTP flash or the old Qwen realtime protocol')
      assert.equal(parameters.format, 'pcm'); assert.equal(parameters.sample_rate, 16000)
      if (model.endsWith('-message')) {
        assert.equal(parameters.intermediate_result_enabled, true)
        assert.equal(parameters.disfluency_removal_enabled, providerPolish)
        assert.deepEqual(parameters.vocabulary, { SayRel: 5 })
        assert.equal(result.providerPolish, providerPolish)
      } else {
        assert.equal(parameters.disfluency_removal_enabled, undefined, 'streaming must not receive the message-only polishing flag')
        assert.equal(result.providerPolish, undefined)
      }
      const replay = await transcribeProfile(profile(endpoint), model, { ...request, providerPolish, allowEmpty: true })
      assert.equal(replay.text, '最终成稿。第二句。', 'complete-audio fallback must retain the same selected task model')
      checks++
    } finally {
      for (const socket of server.clients) socket.terminate()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  }
}

const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
server.on('connection', socket => socket.on('message', (data, binary) => {
  if (binary) return
  const message = runSchema.parse(JSON.parse(data.toString()))
  const event = message.header.action === 'run-task' ? 'task-started' : 'task-finished'
  if (event === 'task-finished') socket.send(JSON.stringify({ header: { event: 'result-generated' }, payload: { output: { sentence: { sentence_id: 1, text: '未确认草稿', sentence_end: false } } } }))
  socket.send(JSON.stringify({ header: { event }, payload: {} }))
}))
await once(server, 'listening')
const address = server.address(); assert(address && typeof address !== 'string')
try {
  const session = startLiveTranscription(profile(`ws://127.0.0.1:${address.port}`), models[0], request, () => {})
  session.pushPcm(request.pcm)
  await assert.rejects(session.finish(), /final sentence/, 'unconfirmed partial text is not a successful final result')
  await assert.rejects(transcribeProfile(profile(`ws://127.0.0.1:${address.port}`), models[0], request), /final sentence/, 'complete-audio replay also rejects unfinished drafts instead of hanging')
  checks++
} finally {
  for (const socket of server.clients) socket.terminate()
  await new Promise<void>(resolve => server.close(() => resolve()))
}
console.log(`PASS Qwen 3.1 ASR: ${checks} live/replay/polishing/final-boundary scenarios`)
