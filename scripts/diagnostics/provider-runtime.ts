import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { z } from 'zod'
import OpusScript from 'opusscript'
import { PROVIDER_PRESETS } from '../../src/shared/providerPresets'
import { providerProfileSchema, EMPTY_SERVICE_PROVIDERS, type ProviderProfile } from '../../src/shared/providers'
import { completeChat, createProviders, listProviderModels, testProvider, transcribeProfile } from '../../src/main/services/providers'
import { decodeHistoryAudio, wavAudio } from '../../src/main/services/providers/audio'
import { runVoiceAction } from '../../src/main/services/voiceActions'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import { elevenlabsRestUrl, endpointUrl } from '../../src/main/services/providers/transport'

const requests: { path: string; headers: IncomingMessage['headers']; body: Buffer }[] = []
let reply: (res: ServerResponse) => void = res => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'clean result' } }] })) }
const server = createServer(async (req, res) => {
  const body: Buffer[] = []
  for await (const part of req) body.push(Buffer.from(part))
  requests.push({ path: req.url ?? '', headers: req.headers, body: Buffer.concat(body) })
  reply(res)
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const address = server.address()
assert(address && typeof address !== 'string')
const base = `http://127.0.0.1:${address.port}/v1`
const common = { id: 'probe', presetId: '', name: 'Probe', enabled: true, endpoint: base, apiKey: 'local-test-secret', models: ['probe-model'], appId: '', accessToken: '', resourceId: '', apiVersion: '2024-10-21' }
function profile(protocol: string): ProviderProfile { return providerProfileSchema.parse({ ...common, protocol, service: ['openai-transcription', 'elevenlabs', 'stepfun-asr', 'mimo-asr', 'audio-chat', 'local-whisper'].includes(protocol) ? 'transcription' : 'refinement' }) }
function json(value: unknown) { reply = res => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)) } }
function last() { const request = requests.at(-1); assert(request); return request }
const record = z.record(z.string(), z.unknown())
function body() { return record.parse(JSON.parse(last().body.toString())) }
let checks = 0
try {
  assert.equal(endpointUrl(`${base}/chat/completions?route=one`, '/chat/completions').toString(), `${base}/chat/completions?route=one`); checks++
  const messages = [{ role: 'system', content: 'Clean text' }, { role: 'user', content: 'hello' }] satisfies Parameters<typeof completeChat>[2]
  for (const protocol of ['openai-chat', 'openai-responses', 'anthropic', 'gemini', 'ollama', 'azure-openai']) {
    const selected = profile(protocol)
    json(protocol === 'openai-responses' ? { output: [{ type: 'message', content: [{ type: 'output_text', text: 'clean result' }] }] } : protocol === 'anthropic' ? { content: [{ type: 'text', text: 'clean result' }] } : protocol === 'gemini' ? { candidates: [{ content: { parts: [{ text: 'clean result' }] } }] } : protocol === 'ollama' ? { message: { content: 'clean result' } } : { choices: [{ message: { content: 'clean result' } }] })
    assert.equal(await completeChat(selected, 'probe-model', messages), 'clean result')
    const request = last()
    if (protocol === 'anthropic') { assert.equal(request.headers['x-api-key'], common.apiKey); assert.equal(body().system, 'Clean text'); assert.match(request.path, /\/messages$/) }
    else if (protocol === 'gemini') { assert.equal(request.headers['x-goog-api-key'], common.apiKey); assert.match(request.path, /\/models\/probe-model:generateContent$/); assert(Array.isArray(body().contents)) }
    else if (protocol === 'azure-openai') { assert.equal(request.headers['api-key'], common.apiKey); assert.match(request.path, /\/openai\/deployments\/probe-model\/chat\/completions\?api-version=2024-10-21/); assert(!('model' in body())) }
    else { assert.equal(request.headers.authorization, `Bearer ${common.apiKey}`); assert.equal(body().model, 'probe-model') }
    if (protocol === 'openai-responses') assert(Array.isArray(body().input))
    if (protocol === 'ollama') { assert.match(request.path, /\/api\/chat$/); assert.equal(body().stream, false) }
    checks++
  }
  for (const protocol of ['openai-chat', 'anthropic', 'gemini', 'ollama']) {
    json(protocol === 'gemini' ? { models: [{ name: 'models/example', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] }] } : protocol === 'ollama' ? { models: [{ name: 'example' }] } : { data: [{ id: 'example' }] })
    assert.deepEqual(await listProviderModels(profile(protocol)), ['example']); checks++
  }
  const encoder = new OpusScript(16000, 1, OpusScript.Application.AUDIO)
  const packet = encoder.encode(Buffer.alloc(640), 320)
  encoder.delete()
  const page = Buffer.alloc(28 + packet.length)
  page.write('OggS'); page[26] = 1; page[27] = packet.length; packet.copy(page, 28)
  const decoded = decodeHistoryAudio(page)
  assert.equal(decoded.pcm.length, 320); assert.equal(decoded.sampleRate, 16000)
  assert(decoded.pcm.every(Number.isFinite)); assert.throws(() => decodeHistoryAudio(Buffer.from('invalid')), /format is invalid/); checks++
  const pcm = new Float32Array(3200)
  const audio = wavAudio(pcm, 16000)
  const input = { pcm, sampleRate: 16000, audioBuffer: audio, mimeType: 'audio/wav', durationMs: 200, mode: 'voice_transcript' } satisfies Parameters<typeof transcribeProfile>[2]
  for (const protocol of ['openai-transcription', 'elevenlabs']) {
    json({ text: 'recognized', language_code: 'en' })
    assert.equal((await transcribeProfile(profile(protocol), 'probe-model', input)).text, 'recognized')
    const request = last()
    assert.match(String(request.headers['content-type']), /multipart\/form-data/)
    const multipart = request.body.toString('latin1')
    assert(multipart.includes('RIFF')); assert(multipart.includes('name="file"')); assert(multipart.includes('probe-model'))
    if (protocol === 'elevenlabs') { assert.equal(request.headers['xi-api-key'], common.apiKey); assert.equal(request.headers.authorization, undefined); assert(multipart.includes('name="model_id"')); assert.match(request.path, /\/speech-to-text$/) }
    else { assert.equal(request.headers.authorization, `Bearer ${common.apiKey}`); assert.match(request.path, /\/audio\/transcriptions$/) }
    checks++
  }
  for (const request of [{ ...input, audioBuffer: page, mimeType: 'audio/ogg' }, { ...input, pcm: undefined, audioBuffer: page, mimeType: 'audio/ogg' }]) {
    json({ text: 'recognized' })
    await transcribeProfile(profile('openai-transcription'), 'probe-model', request)
    const multipart = last().body
    assert(multipart.includes(Buffer.from('Content-Type: audio/wav')))
    assert(multipart.includes(Buffer.from('filename="audio.wav"')))
    assert(multipart.includes(wavAudio(request.pcm ?? decoded.pcm, 16000)))
    assert(!multipart.includes(Buffer.from('OggS'))); checks++
  }
  json({ text: 'recognized' })
  const mp3 = Buffer.from('ID3-original-mp3-payload')
  await transcribeProfile(profile('openai-transcription'), 'probe-model', { ...input, pcm: undefined, audioBuffer: mp3, mimeType: 'audio/mpeg' })
  assert(last().body.includes(mp3)); assert(last().body.includes(Buffer.from('Content-Type: audio/mpeg')))
  assert(last().body.includes(Buffer.from('filename="audio.mp3"'))); checks++
  const elevenPreset = PROVIDER_PRESETS.find(preset => preset.protocol === 'elevenlabs')
  assert(elevenPreset)
  assert.equal(elevenlabsRestUrl(elevenPreset.endpoint).toString(), 'https://api.elevenlabs.io/v1/speech-to-text'); checks++
  const elevenHttp = { ...profile('elevenlabs'), endpoint: `ws://127.0.0.1:${address.port}/proxy/v1/speech-to-text/realtime?keep=yes&model_id=scribe_v2_realtime`, models: ['scribe_v2'] }
  json({ text: 'recognized' })
  await transcribeProfile(elevenHttp, 'scribe_v2', input)
  assert.equal(last().path, '/proxy/v1/speech-to-text?keep=yes')
  assert.equal(last().headers['xi-api-key'], common.apiKey)
  assert(last().body.toString().includes('scribe_v2')); checks++
  for (const protocol of ['mimo-asr', 'audio-chat']) {
    json({ choices: [{ message: { content: 'recognized' } }] })
    assert.equal((await transcribeProfile(profile(protocol), 'probe-model', input)).text, 'recognized')
    assert.match(last().path, /\/chat\/completions$/); assert.equal(body().stream, false)
    const content = z.object({ messages: z.array(z.object({ role: z.string(), content: z.union([z.string(), z.array(z.union([z.object({ type: z.literal('text'), text: z.string() }), z.object({ type: z.literal('input_audio'), input_audio: z.object({ data: z.string(), format: z.string().optional() }) })]))]) })) }).parse(body()).messages.flatMap(message => typeof message.content === 'string' ? [] : message.content).find(part => part.type === 'input_audio')
    assert(content?.type === 'input_audio')
    if (protocol === 'audio-chat') assert.equal(content.input_audio.format, 'wav')
    assert.equal(content.input_audio.data, protocol === 'mimo-asr' ? `data:audio/wav;base64,${audio.toString('base64')}` : audio.toString('base64')); checks++
  }
  reply = res => { res.setHeader('content-type', 'text/event-stream'); res.write('data: {"type":"transcript.text.delta","delta":"rec"}\n\n'); res.end('data: {"type":"transcript.text.done","text":"recognized"}\n\ndata: [DONE]\n\n') }
  assert.equal((await transcribeProfile(profile('stepfun-asr'), 'probe-model', input)).text, 'recognized')
  assert.match(last().path, /\/audio\/asr\/sse$/)
  const step = z.object({ audio: z.object({ data: z.string(), input: z.object({ transcription: z.object({ model: z.string() }), format: z.object({ type: z.string() }) }) }) }).parse(body())
  assert.equal(step.audio.data, audio.toString('base64')); assert.equal(step.audio.input.transcription.model, 'probe-model'); assert.equal(step.audio.input.format.type, 'wav'); checks++
  for (const request of [{ ...input, audioBuffer: page, mimeType: 'audio/ogg' }, { ...input, pcm: undefined, audioBuffer: page, mimeType: 'audio/ogg' }]) {
    await transcribeProfile(profile('stepfun-asr'), 'probe-model', request)
    const stepAudio = z.object({ audio: z.object({ data: z.string(), input: z.object({ format: z.object({ type: z.string(), rate: z.number() }) }) }) }).parse(body())
    assert.equal(stepAudio.audio.input.format.type, 'wav'); assert.equal(stepAudio.audio.input.format.rate, 16000)
    assert(Buffer.from(stepAudio.audio.data, 'base64').equals(wavAudio(request.pcm ?? decoded.pcm, 16000))); checks++
  }
  json({ text: '' })
  assert.equal((await testProvider(profile('openai-transcription'), 'probe-model')).ok, true)
  await assert.rejects(transcribeProfile(profile('openai-transcription'), 'probe-model', input), /empty result/); checks++
  json({ invalid: 'local-test-secret' })
  await assert.rejects(completeChat(profile('openai-chat'), 'probe-model', messages), /response does not match/); checks++
  reply = res => { res.statusCode = 401; res.end('local-test-secret server internal response') }
  await assert.rejects(completeChat(profile('openai-chat'), 'probe-model', messages), error => error instanceof Error && error.message.includes('401') && !error.message.includes('secret')); checks++
  reply = res => { res.setHeader('content-type', 'application/json'); res.end('{invalid') }
  await assert.rejects(completeChat(profile('openai-chat'), 'probe-model', messages), /invalid JSON/); checks++
  json({ choices: [{ message: { content: '' } }] })
  await assert.rejects(completeChat(profile('openai-chat'), 'probe-model', messages), /empty result/); checks++
  const selectedRefinement = profile('openai-chat')
  const config = { ...DEFAULT_SETTINGS, serviceProviders: { profiles: [selectedRefinement], transcription: null, refinement: { providerId: selectedRefinement.id, model: 'probe-model' } } }
  json({ choices: [{ message: { content: 'translated' } }] })
  assert.equal(await runVoiceAction({ transcript: 'hello', mode: 'translation', context: null, config, signal: new AbortController().signal }), 'translated')
  assert.match(JSON.stringify(body().messages), /Translate the user's dictated text/)
  await assert.rejects(runVoiceAction({ transcript: 'hello', mode: 'ask_anything', context: null, config: { ...DEFAULT_SETTINGS, serviceProviders: EMPTY_SERVICE_PROVIDERS }, signal: new AbortController().signal }), /language model provider/); checks++
  reply = res => { res.setHeader('content-type', 'text/event-stream'); res.end('data: {"type":"transcript.text.delta","delta":"partial"}\n\n') }
  await assert.rejects(transcribeProfile(profile('stepfun-asr'), 'probe-model', input), /disconnected before returning the complete transcript/); checks++
  reply = () => {}
  await assert.rejects(completeChat(profile('openai-chat'), 'probe-model', messages, AbortSignal.timeout(30)), /cancelled/); checks++
  const legacy = { transcription: 'mock', refinement: 'mock', baseUrl: null, apiKey: null, model: null, refinementModel: null } satisfies Parameters<typeof createProviders>[0]
  const unconfigured = createProviders(legacy, EMPTY_SERVICE_PROVIDERS)
  await assert.rejects(unconfigured.transcription.transcribe(input), /Configure and select/)
  assert.equal((await unconfigured.refinement.refine({ transcript: ' raw ', mode: 'voice_transcript' })).text, 'raw')
  assert.match((await createProviders(legacy).transcription.transcribe(input)).text, /mock transcript/); checks++
  const whisperDir = await mkdtemp(join(tmpdir(), 'sayrel-whisper-probe-'))
  try {
    const binary = join(whisperDir, 'whisper-probe')
    await writeFile(binary, '#!/usr/bin/env node\nconst fs=require("node:fs");const a=process.argv;const wav=fs.readFileSync(a[a.indexOf("-f")+1]);if(wav.toString("ascii",0,4)!=="RIFF")process.exit(2);fs.writeFileSync(a[a.indexOf("--output-file")+1]+".txt","");', { mode: 0o755 })
    const local = { ...profile('local-whisper'), endpoint: binary }
    assert.equal((await testProvider(local, 'probe-model')).ok, true, 'silence validates CLI processing without requiring recognized text'); checks++
    await assert.rejects(transcribeProfile(local, 'probe-model', input), /Whisper/); checks++
  } finally { await rm(whisperDir, { recursive: true, force: true }) }
  process.stdout.write(`Provider runtime: ${checks} transport and failure checks passed.\n`)
} finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
