import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { gzipSync, gunzipSync } from 'node:zlib'
import { WebSocket } from 'undici'
import { z } from 'zod'
import type { ProviderProfile } from '../../../shared/providers'
import type { TranscriptionRequest, TranscriptionResult } from '../../../shared/types'
import { decodeHistoryAudio, pcm16, wavAudio } from './audio'
import { bearer, parsed, ProviderError, responseJson, withProviderRequest } from './transport'

type Send = (message: string | Buffer) => void
type Update = { ready?: boolean; done?: boolean }
type RealtimeSession = {
  begin: (send: Send) => void
  receive: (message: string | Buffer) => Update
  audio: (chunk: Buffer, last: boolean, send: Send) => void
  finish: (send: Send) => void
  result: () => Pick<TranscriptionResult, 'text' | 'detectedLanguage'>
}
const malformed = (): ProviderError => new ProviderError('实时转写服务返回了无效的协议消息')
const eventSchema = z.object({
  type: z.string(), item_id: z.string().optional(), transcript: z.string().optional(),
  language: z.string().optional(), languages: z.array(z.object({ code: z.string() })).optional(),
  error: z.object({ code: z.union([z.string(), z.number()]).optional() }).optional()
})
const safeCode = (code: string | number | undefined): string => String(code ?? 'unknown').replace(/[^\w.-]/g, '').slice(0, 60)
function serviceFailure(code?: string | number): never {
  throw new ProviderError(`实时转写失败 (${safeCode(code)})，请检查密钥、模型与服务权限`)
}
function jsonMessage(message: string | Buffer): unknown {
  try { return JSON.parse(message.toString()) }
  catch { throw malformed() }
}
function sendEvent(send: Send, type: string, data: object = {}): void {
  send(JSON.stringify({ event_id: randomUUID(), type, ...data }))
}

function websocketUrl(endpoint: string, path: string): URL {
  const url = new URL(endpoint)
  if (url.username || url.password || !['ws:', 'wss:', 'http:', 'https:'].includes(url.protocol)) throw new ProviderError('实时服务地址必须使用 WebSocket 或 HTTP')
  url.protocol = ['https:', 'wss:'].includes(url.protocol) ? 'wss:' : 'ws:'
  if (url.pathname === '/' || !url.pathname) url.pathname = path
  return url
}

function audioSamples(req: TranscriptionRequest, targetRate: number): Buffer {
  const audio = req.pcm && req.sampleRate ? { pcm: req.pcm, sampleRate: req.sampleRate } : req.audioBuffer ? decodeHistoryAudio(req.audioBuffer) : null
  if (!audio || !audio.pcm.length || !Number.isFinite(audio.sampleRate) || audio.sampleRate <= 0) throw new ProviderError('没有可用于实时转写的 PCM 音频')
  if (audio.pcm.some(sample => !Number.isFinite(sample))) throw new ProviderError('录音包含无效的音频采样')
  if (audio.sampleRate === targetRate) return pcm16(audio.pcm)
  const ratio = audio.sampleRate / targetRate
  const samples = new Float32Array(Math.max(1, Math.round(audio.pcm.length / ratio)))
  for (let i = 0; i < samples.length; i++) {
    if (ratio > 1) {
      // Average the source interval before downsampling to suppress high-frequency aliasing.
      const start = Math.min(i * ratio, audio.pcm.length - 1), end = Math.min((i + 1) * ratio, audio.pcm.length)
      let sum = 0
      for (let j = Math.floor(start); j < Math.ceil(end); j++) sum += audio.pcm[j] * (Math.min(j + 1, end) - Math.max(j, start))
      samples[i] = sum / (end - start)
    } else {
      const position = Math.min(i * ratio, audio.pcm.length - 1), left = Math.floor(position)
      samples[i] = audio.pcm[left] + (audio.pcm[Math.min(left + 1, audio.pcm.length - 1)] - audio.pcm[left]) * (position - left)
    }
  }
  return pcm16(samples)
}

function qwenSession(model: string, req: TranscriptionRequest, openai: boolean): RealtimeSession {
  const transcripts = new Map<string, string>()
  let language: string | null = null
  return {
    begin(send) {
      const transcription = openai
        ? { model, ...(req.dictionary?.length && model !== 'gpt-realtime-whisper' ? { prompt: req.dictionary.join(', ') } : {}), ...(req.language ? (['gpt-live-transcribe', 'gpt-transcribe'].includes(model) ? { languages: req.languages?.length ? req.languages : [req.language] } : { language: req.language }) : {}) }
        : { ...(req.language ? { language: req.language } : {}) }
      const session = openai
        ? { type: 'transcription', audio: { input: { format: { type: 'audio/pcm', rate: 24000 }, transcription, turn_detection: null } } }
        : { input_audio_format: 'pcm', sample_rate: 16000, input_audio_transcription: transcription, turn_detection: null }
      sendEvent(send, 'session.update', { session })
    },
    receive(message) {
      const event = parsed(eventSchema, jsonMessage(message))
      if (event.type === 'error' || event.type.endsWith('.failed')) serviceFailure(event.error?.code)
      if (event.type === 'session.updated' || event.type === 'transcription_session.updated') return { ready: true }
      if (event.type === 'conversation.item.input_audio_transcription.completed') {
        if (event.transcript === undefined) throw malformed()
        transcripts.set(event.item_id ?? 'recording', event.transcript)
        language = event.language ?? event.languages?.[0]?.code ?? language
        return { done: openai }
      }
      return { done: !openai && event.type === 'session.finished' }
    },
    audio(chunk, _last, send) { sendEvent(send, 'input_audio_buffer.append', { audio: chunk.toString('base64') }) },
    finish(send) {
      sendEvent(send, 'input_audio_buffer.commit')
      if (!openai) sendEvent(send, 'session.finish')
    },
    result: () => ({ text: [...transcripts.values()].join(''), detectedLanguage: language })
  }
}

const funEventSchema = z.object({
  header: z.object({ event: z.string(), error_code: z.union([z.string(), z.number()]).optional() }),
  payload: z.object({ output: z.object({ sentence: z.object({ sentence_id: z.number(), text: z.string(), sentence_end: z.boolean() }).optional() }).optional() }).optional()
})
function funSession(model: string, req: TranscriptionRequest, rate: number): RealtimeSession {
  const taskId = randomUUID(), sentences = new Map<number, string>()
  return {
    begin(send) {
      send(JSON.stringify({ header: { action: 'run-task', task_id: taskId, streaming: 'duplex' }, payload: {
        task_group: 'audio', task: 'asr', function: 'recognition', model,
        parameters: { format: 'pcm', sample_rate: rate, ...(req.language ? { language_hints: [req.language] } : {}) }, input: {}
      } }))
    },
    receive(message) {
      const event = parsed(funEventSchema, jsonMessage(message))
      if (event.header.event === 'task-failed' || event.header.error_code) serviceFailure(event.header.error_code)
      const sentence = event.payload?.output?.sentence
      if (sentence?.sentence_end) sentences.set(sentence.sentence_id, sentence.text)
      return { ready: event.header.event === 'task-started', done: event.header.event === 'task-finished' }
    },
    audio(chunk, _last, send) { send(chunk) },
    finish(send) { send(JSON.stringify({ header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' }, payload: { input: {} } })) },
    result: () => ({ text: [...sentences.entries()].sort(([a], [b]) => a - b).map(([, text]) => text).join(''), detectedLanguage: null })
  }
}

const sonioxSchema = z.object({
  tokens: z.array(z.object({ text: z.string(), is_final: z.boolean(), language: z.string().optional(), translation_status: z.string().optional() })).optional(),
  finished: z.boolean().optional(), error_code: z.union([z.string(), z.number()]).optional()
})
function sonioxSession(model: string, req: TranscriptionRequest, apiKey: string): RealtimeSession {
  let text = '', language: string | null = null
  return {
    begin(send) {
      send(JSON.stringify({ ...(apiKey ? { api_key: apiKey } : {}), model, audio_format: 'pcm_s16le', sample_rate: 16000, num_channels: 1,
        ...(req.language || req.languages?.length ? { language_hints: req.languages?.length ? req.languages : [req.language] } : {}),
        ...(req.dictionary?.length ? { context: { terms: req.dictionary } } : {}) }))
    },
    receive(message) {
      const event = parsed(sonioxSchema, jsonMessage(message))
      if (event.error_code) serviceFailure(event.error_code)
      if (!event.tokens && event.finished === undefined) throw malformed()
      for (const token of event.tokens ?? []) {
        if (token.is_final && token.translation_status !== 'translation' && !['<end>', '<fin>'].includes(token.text)) {
          text += token.text
          language = token.language ?? language
        }
      }
      return { done: event.finished === true }
    },
    audio(chunk, _last, send) { send(chunk) }, finish(send) { send('') },
    result: () => ({ text, detectedLanguage: language })
  }
}

const elevenSchema = z.object({ message_type: z.string(), text: z.string().optional() })
function elevenSession(): RealtimeSession {
  let text = ''
  return {
    begin() {},
    receive(message) {
      const event = parsed(elevenSchema, jsonMessage(message))
      if (event.message_type === 'session_started') return { ready: true }
      if (event.message_type === 'committed_transcript') {
        if (event.text === undefined) throw malformed()
        text = event.text
        return { done: true }
      }
      if (!['partial_transcript', 'warning', 'committed_transcript_with_timestamps', 'committed_transcript_entities', 'edited_transcript'].includes(event.message_type)) serviceFailure(event.message_type)
      return {}
    },
    audio(chunk, _last, send) { send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: chunk.toString('base64'), sample_rate: 16000 })) },
    finish(send) { send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: '', sample_rate: 16000, commit: true })) },
    result: () => ({ text, detectedLanguage: null })
  }
}

function volcPacket(type: number, sequence: number, last: boolean, payload: Buffer): Buffer {
  const compressed = gzipSync(payload), header = Buffer.alloc(12)
  header[0] = 0x11; header[1] = (type << 4) | (last ? 3 : 1); header[2] = type === 1 ? 0x11 : 0x01
  header.writeInt32BE(last ? -sequence : sequence, 4); header.writeUInt32BE(compressed.length, 8)
  return Buffer.concat([header, compressed])
}
const volcResultSchema = z.object({
  code: z.number().optional(), result: z.union([z.object({ text: z.string().optional() }), z.array(z.object({ text: z.string().optional() }))]).nullish()
})
function volcResponse(message: string | Buffer): { final: boolean; response: z.infer<typeof volcResultSchema> } {
  if (!Buffer.isBuffer(message) || message.length < 8 || message[0] >> 4 !== 1) throw malformed()
  const type = message[1] >> 4, flags = message[1] & 15, serialization = message[2] >> 4, compression = message[2] & 15
  let offset = (message[0] & 15) * 4
  if (offset < 4 || offset > message.length) throw malformed()
  if (flags & 1) offset += 4
  if (flags & 4) offset += 4
  if (![9, 15].includes(type) || message.length < offset + (type === 15 ? 8 : 4)) throw malformed()
  if (type === 15) serviceFailure(message.readUInt32BE(offset))
  const length = message.readUInt32BE(offset); offset += 4
  if (length !== message.length - offset || ![0, 1].includes(compression) || serialization !== 1) throw malformed()
  let payload = message.subarray(offset)
  if (compression === 1) {
    try { payload = gunzipSync(payload, { maxOutputLength: 8 * 1024 * 1024 }) }
    catch { throw malformed() }
  }
  const response = parsed(volcResultSchema, jsonMessage(payload))
  if (response.code !== undefined && ![0, 1000, 20000000].includes(response.code)) serviceFailure(response.code)
  return { final: Boolean(flags & 2), response }
}
function volcSession(req: TranscriptionRequest): RealtimeSession {
  let sequence = 1, text = ''
  return {
    begin(send) {
      send(volcPacket(1, sequence++, false, Buffer.from(JSON.stringify({
        user: { uid: 'offkey' }, audio: { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1 },
        request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true, show_utterances: true, result_type: 'full',
          ...(req.dictionary?.length ? { corpus: { context: JSON.stringify({ hotwords: req.dictionary.map(word => ({ word })) }) } } : {}) }
      }))))
    },
    receive(message) {
      const event = volcResponse(message)
      const result = event.response.result
      if (Array.isArray(result)) text = result.map(item => item.text ?? '').join('')
      else if (result?.text !== undefined) text = result.text
      return { ready: true, done: event.final }
    },
    audio(chunk, last, send) { send(volcPacket(2, sequence++, last, chunk)) }, finish() {},
    result: () => ({ text, detectedLanguage: null })
  }
}

async function runSession(options: { url: URL; headers: Record<string, string>; session: RealtimeSession; audio: Buffer; sampleRate: number; readyOnOpen: boolean; signal?: AbortSignal }): Promise<Pick<TranscriptionResult, 'text' | 'detectedLanguage'>> {
  if (options.signal?.aborted) throw new ProviderError('请求已取消')
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(options.url, { headers: options.headers })
    socket.binaryType = 'arraybuffer'
    const stop = new AbortController()
    let settled = false, started = false, sealed = false
    const deadline = setTimeout(() => fail(new ProviderError('实时转写超时，请检查服务地址和网络')), 45_000 + Math.ceil(options.audio.length / (options.sampleRate * 2) * 1000))
    const connectDeadline = setTimeout(() => fail(new ProviderError('实时服务未完成连接或配置确认，请检查地址、密钥与协议')), 15_000)
    const onAbort = (): void => fail(new ProviderError('请求已取消'))
    function cleanup(): void {
      clearTimeout(deadline); clearTimeout(connectDeadline); stop.abort()
      options.signal?.removeEventListener('abort', onAbort)
      socket.onopen = null; socket.onmessage = null; socket.onclose = null; socket.onerror = null
      try { socket.close() } catch { /* Connection may already have failed. */ }
    }
    function fail(error: unknown): void {
      if (settled) return
      settled = true; cleanup()
      reject(error instanceof ProviderError ? error : malformed())
    }
    const send: Send = message => {
      if (settled || socket.readyState !== WebSocket.OPEN) throw new ProviderError('实时转写连接已断开')
      socket.send(message)
    }
    async function stream(): Promise<void> {
      if (started || settled) return
      started = true; clearTimeout(connectDeadline)
      const bytesPerChunk = options.sampleRate / 5 * 2, start = performance.now()
      try {
        for (let offset = 0; offset < options.audio.length; offset += bytesPerChunk) {
          const wait = start + offset / (options.sampleRate * 2) * 1000 - performance.now()
          if (wait > 0) await sleep(wait, undefined, { signal: stop.signal })
          if (settled) return
          const chunk = options.audio.subarray(offset, offset + bytesPerChunk), last = offset + chunk.length >= options.audio.length
          while (socket.bufferedAmount > 256 * 1024) await sleep(20, undefined, { signal: stop.signal })
          if (last) sealed = true
          options.session.audio(chunk, last, send)
        }
        options.session.finish(send)
      } catch (error) { if (!settled) fail(error) }
    }
    socket.onopen = () => {
      try { options.session.begin(send); if (options.readyOnOpen) void stream() }
      catch (error) { fail(error) }
    }
    socket.onmessage = event => {
      try {
        const data: unknown = event.data
        if (typeof data !== 'string' && !(data instanceof ArrayBuffer)) throw malformed()
        const update = options.session.receive(typeof data === 'string' ? data : Buffer.from(data))
        if (update.done) {
          if (!sealed) throw new ProviderError('服务商在音频发送完成前结束了转写，请重试')
          settled = true; cleanup(); resolve(options.session.result())
        } else if (update.ready) void stream()
      } catch (error) { fail(error) }
    }
    socket.onerror = () => fail(new ProviderError('实时服务连接失败，请检查地址、密钥与网络'))
    socket.onclose = () => fail(new ProviderError('实时服务在最终结果到达前断开连接，请重试'))
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted) onAbort()
  })
}

const flashSchema = z.object({ output: z.object({ text: z.string().optional(), output: z.object({ sentence: z.object({ text: z.string() }) }).optional() }) })
async function funFlash(profile: ProviderProfile, model: string, req: TranscriptionRequest): Promise<TranscriptionResult> {
  const audio = audioSamples(req, 16000)
  if (audio.length > 16000 * 2 * 300) throw new ProviderError('Fun-ASR Flash 单次录音不能超过 5 分钟')
  const url = websocketUrl(profile.endpoint, '/')
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  if (/\/api-ws\/v1\/(realtime|inference)\/?$/.test(url.pathname) || url.pathname === '/') url.pathname = '/api/v1/services/aigc/multimodal-generation/generation'
  url.searchParams.delete('model')
  const samples = new Float32Array(audio.length / 2)
  for (let i = 0; i < samples.length; i++) samples[i] = audio.readInt16LE(i * 2) / 32768
  const wav = wavAudio(samples, 16000)
  return withProviderRequest(req.signal, async signal => {
    const result = parsed(flashSchema, await responseJson(await fetch(url, { method: 'POST', headers: { ...bearer(profile.apiKey), 'Content-Type': 'application/json', 'X-DashScope-SSE': 'disable' }, signal,
      body: JSON.stringify({ model, input: { messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${wav.toString('base64')}` } }] }] },
        parameters: { format: 'wav', sample_rate: '16000', ...(req.language ? { language: req.language } : {}), ...(req.dictionary?.length ? { vocabulary: Object.fromEntries(req.dictionary.map(word => [word, 5])) } : {}) } })
    })))
    const text = result.output.text ?? result.output.output?.sentence.text
    if (text === undefined) throw malformed()
    return { text, detectedLanguage: null, provider: profile.id }
  })
}

export async function transcribeRealtime(profile: ProviderProfile, model: string, req: TranscriptionRequest): Promise<TranscriptionResult> {
  if (profile.protocol === 'qwen-asr' && /^(?:fun-asr-flash|qwen-audio-[\d.]+-asr-flash)/.test(model) && !model.includes('realtime')) return funFlash(profile, model, req)
  let url: URL, session: RealtimeSession, sampleRate = 16000, readyOnOpen = false
  const headers: Record<string, string> = {}
  switch (profile.protocol) {
    case 'qwen-asr': {
      const fun = model.startsWith('fun-asr')
      sampleRate = fun && model.includes('8k') ? 8000 : 16000
      url = websocketUrl(profile.endpoint, '/api-ws/v1/realtime')
      if (/\/api-ws\/v1\/(inference|realtime)\/?$/.test(url.pathname)) url.pathname = `/api-ws/v1/${fun ? 'inference' : 'realtime'}`
      Object.assign(headers, bearer(profile.apiKey))
      if (fun) session = funSession(model, req, sampleRate)
      else {
        url.searchParams.set('model', model === 'qwen3-asr-flash' ? 'qwen3-asr-flash-realtime' : model)
        session = qwenSession(model, req, false)
      }
      break
    }
    case 'openai-realtime':
      url = websocketUrl(profile.endpoint, '/v1/realtime'); url.searchParams.set('intent', 'transcription')
      Object.assign(headers, bearer(profile.apiKey)); sampleRate = 24000
      session = qwenSession(model, req, true)
      break
    case 'soniox':
      url = websocketUrl(profile.endpoint, '/transcribe-websocket'); Object.assign(headers, bearer(profile.apiKey))
      session = sonioxSession(model, req, profile.apiKey); readyOnOpen = true
      break
    case 'elevenlabs':
      url = websocketUrl(profile.endpoint, '/v1/speech-to-text/realtime')
      url.searchParams.set('model_id', model); url.searchParams.set('audio_format', 'pcm_16000'); url.searchParams.set('commit_strategy', 'manual')
      if (req.language) url.searchParams.set('language_code', req.language)
      if (profile.apiKey) headers['xi-api-key'] = profile.apiKey
      session = elevenSession()
      break
    case 'volcengine-asr': {
      if (!['bigmodel', 'bigmodel_nostream', 'bigmodel_async'].includes(model)) throw new ProviderError('火山引擎模型须为 bigmodel、bigmodel_nostream 或 bigmodel_async')
      url = websocketUrl(profile.endpoint, '/api/v3/sauc/bigmodel_nostream')
      if (/\/api\/v3\/(?:plan\/)?sauc\/bigmodel(?:_nostream|_async)?\/?$/.test(url.pathname)) url.pathname = url.pathname.replace(/bigmodel(?:_nostream|_async)?\/?$/, model)
      readyOnOpen = /\/bigmodel_async\/?$/.test(url.pathname)
      const requestId = randomUUID()
      headers['X-Api-Resource-Id'] = profile.resourceId || 'volc.bigasr.sauc.duration'
      headers['X-Api-Connect-Id'] = requestId; headers['X-Api-Request-Id'] = requestId
      if (profile.apiKey) headers['X-Api-Key'] = profile.apiKey
      else { headers['X-Api-App-Key'] = profile.appId; headers['X-Api-Access-Key'] = profile.accessToken }
      session = volcSession(req)
      break
    }
    default: throw new ProviderError('所选协议不支持实时转写')
  }
  const result = await runSession({ url, headers, session, audio: audioSamples(req, sampleRate), sampleRate, readyOnOpen, signal: req.signal })
  return { ...result, provider: profile.id }
}
