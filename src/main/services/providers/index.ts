import { z } from 'zod'
import { selectedProvider, type ProviderProfile, type ProviderTestResult, type ServiceProviders } from '../../../shared/providers'
import type { RefineRequest, RefineResult, TranscriptionRequest, TranscriptionResult } from '../../../shared/types'
import { normalizeText } from './postprocess'
import { completeChat } from './chat'
import { bearer, elevenlabsRestUrl, endpointUrl, outputText, parsed, ProviderError, responseJson, withProviderRequest } from './transport'
import { decodeHistoryAudio, wavAudio } from './audio'
export { completeChat, listProviderModels } from './chat'
export type { ChatMessage } from './chat'

export interface TranscriptionProvider { readonly name: string; transcribe(req: TranscriptionRequest): Promise<TranscriptionResult> }
export interface RefinementProvider { readonly name: string; refine(req: RefineRequest): Promise<RefineResult> }
export type ProviderConfig = {
  transcription: 'offkey-cloud' | 'openai-compatible' | 'local-whisper' | 'mock'
  refinement: 'offkey-cloud' | 'openai-compatible' | 'mock'
  baseUrl: string | null; apiKey: string | null; model: string | null; refinementModel: string | null
}

export function legacyProfile(config: ProviderConfig, service: 'transcription' | 'refinement'): ProviderProfile {
  const common = { id: 'legacy', presetId: 'legacy', name: 'Legacy', enabled: true, endpoint: config.baseUrl ?? 'https://api.openai.com/v1', apiKey: config.apiKey ?? '', models: [service === 'transcription' ? config.model ?? 'whisper-1' : config.refinementModel ?? config.model ?? 'gpt-4o-mini'], appId: '', accessToken: '', resourceId: '', apiVersion: '' }
  return service === 'transcription' ? { ...common, service, protocol: 'openai-transcription' } : { ...common, service, protocol: 'openai-chat' }
}

export class HttpTranscriptionProvider implements TranscriptionProvider {
  constructor(readonly name: string, private readonly opts: { baseUrl: string; apiKey?: string | null; model?: string | null }) {}
  transcribe(req: TranscriptionRequest): Promise<TranscriptionResult> {
    const profile = legacyProfile({ transcription: 'openai-compatible', refinement: 'mock', baseUrl: this.opts.baseUrl, apiKey: this.opts.apiKey ?? null, model: this.opts.model ?? null, refinementModel: null }, 'transcription')
    return transcribeProfile(profile, profile.models[0], req).then(result => ({ ...result, provider: this.name }))
  }
}

export class HttpRefinementProvider implements RefinementProvider {
  constructor(readonly name: string, private readonly opts: { baseUrl: string; apiKey?: string | null; model?: string | null }) {}
  refine(req: RefineRequest): Promise<RefineResult> {
    const profile = legacyProfile({ transcription: 'mock', refinement: 'openai-compatible', baseUrl: this.opts.baseUrl, apiKey: this.opts.apiKey ?? null, model: this.opts.model ?? null, refinementModel: this.opts.model ?? null }, 'refinement')
    return refineProfile(profile, profile.models[0], req)
  }
}

export async function transcribeProfile(profile: ProviderProfile, model: string, req: TranscriptionRequest, allowEmpty = false): Promise<TranscriptionResult> {
  if (profile.service !== 'transcription') throw new Error('请选择语音识别服务商')
  if (profile.protocol === 'local-whisper') return new LocalWhisperProvider(profile.endpoint || 'whisper-cli', model).transcribe(req, allowEmpty)
  if (['qwen-asr', 'volcengine-asr', 'soniox', 'openai-realtime'].includes(profile.protocol) || profile.protocol === 'elevenlabs' && model.includes('realtime')) {
    const decoded = req.pcm?.length ? {} : decodeHistoryAudio(req.audioBuffer?.length ? req.audioBuffer : req.audioPath ? await (await import('node:fs/promises')).readFile(req.audioPath) : Buffer.alloc(0))
    const { transcribeRealtime } = await import('./realtime')
    const result = await transcribeRealtime(profile, model, { ...req, ...decoded })
    return { ...result, text: allowEmpty ? result.text.trim() : outputText(normalizeText(result.text, req)) }
  }
  return withProviderRequest(req.signal, async signal => {
    const source = req.audioBuffer?.length ? req.audioBuffer : req.audioPath ? await (await import('node:fs/promises')).readFile(req.audioPath) : null
    const decoded = req.pcm?.length ? { pcm: req.pcm, sampleRate: req.sampleRate ?? 16000 }
      : source && (source.subarray(0, 4).toString('ascii') === 'OggS' || req.mimeType?.includes('ogg')) ? decodeHistoryAudio(source) : null
    const audio = decoded ? wavAudio(decoded.pcm, decoded.sampleRate) : source
    if (!audio?.length) throw new ProviderError('没有可用的录音数据')
    const mime = decoded ? 'audio/wav' : req.mimeType ?? 'audio/wav'
    const sampleRate = decoded?.sampleRate ?? req.sampleRate ?? 16000
    const extension = mime.includes('wav') ? 'wav' : mime.includes('mpeg') ? 'mp3' : mime.includes('webm') ? 'webm' : mime.includes('mp4') ? 'mp4' : 'ogg'
    const form = new FormData()
    const headers: Record<string, string> = { ...bearer(profile.apiKey) }
    let url: URL
    let body: BodyInit
    if (profile.protocol === 'elevenlabs') {
      url = elevenlabsRestUrl(profile.endpoint)
      delete headers.Authorization
      headers['xi-api-key'] = profile.apiKey
      form.append('model_id', model)
      form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `audio.${extension}`)
      if (req.language) form.append('language_code', req.language)
      form.append('tag_audio_events', 'false')
      form.append('diarize', 'false')
      body = form
    } else if (profile.protocol === 'openai-transcription') {
      url = endpointUrl(profile.endpoint, '/audio/transcriptions')
      form.append('model', model)
      form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `audio.${extension}`)
      if (req.language) form.append('language', req.language)
      if (req.dictionary?.length) form.append('prompt', req.dictionary.join(', '))
      body = form
    } else if (profile.protocol === 'stepfun-asr') {
      url = endpointUrl(profile.endpoint, '/audio/asr/sse')
      headers['content-type'] = 'application/json'
      headers.Accept = 'text/event-stream'
      body = JSON.stringify({ audio: { data: audio.toString('base64'), input: {
        transcription: { model, language: req.language?.split('-')[0] ?? 'zh', full_rerun_on_commit: true, enable_itn: true, ...(req.dictionary?.length ? { prompt: req.dictionary.join(', ') } : {}) },
        format: { type: mime.includes('wav') ? 'wav' : mime.includes('mpeg') ? 'mp3' : 'ogg', rate: sampleRate, bits: 16, channel: 1, ...(mime.includes('wav') ? { codec: 'pcm_s16le' } : {}) }
      } } })
      const response = await fetch(url, { method: 'POST', headers, body, signal })
      if (!response.ok) await responseJson(response)
      const eventSchema = z.object({ type: z.string(), text: z.string().optional(), delta: z.string().optional() })
      let finalText: string | undefined
      for (const line of (await response.text()).split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue
        let payload: unknown
        try { payload = JSON.parse(data) } catch { throw new ProviderError('语音服务返回了无效的流式响应') }
        const event = parsed(eventSchema, payload)
        if (event.type === 'error') throw new ProviderError('语音服务处理失败，请检查模型和音频格式')
        if (event.type === 'transcript.text.done') finalText = event.text
      }
      if (finalText === undefined) throw new ProviderError('语音服务在返回完整转写前断开连接')
      const text = normalizeText(finalText, req)
      return { text: allowEmpty ? text : outputText(text), detectedLanguage: req.language ?? null, provider: profile.name }
    } else if (profile.protocol === 'mimo-asr' || profile.protocol === 'audio-chat') {
      url = endpointUrl(profile.endpoint, '/chat/completions')
      headers['content-type'] = 'application/json'
      const encoded = audio.toString('base64')
      if (profile.protocol === 'mimo-asr' && encoded.length > 10 * 1024 * 1024) throw new ProviderError('MiMo 音频超过 10 MB，请缩短录音后重试')
      body = JSON.stringify({ model, messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:${mime};base64,${encoded}` } }] }], asr_options: { language: req.language?.startsWith('zh') ? 'zh' : req.language?.startsWith('en') ? 'en' : 'auto' }, stream: false })
      const data = parsed(z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) }), await responseJson(await fetch(url, { method: 'POST', headers, body, signal })))
      const text = normalizeText(data.choices[0].message.content, req)
      return { text: allowEmpty ? text : outputText(text), detectedLanguage: req.language ?? null, provider: profile.name }
    } else {
      throw new ProviderError('请选择受支持的语音识别协议')
    }
    const data = parsed(z.object({ text: z.string(), language: z.string().optional(), language_code: z.string().optional() }), await responseJson(await fetch(url, { method: 'POST', headers, body, signal })))
    const text = normalizeText(data.text, req)
    return { text: allowEmpty ? text : outputText(text), detectedLanguage: data.language ?? data.language_code ?? req.language ?? null, provider: profile.name }
  })
}

async function refineProfile(profile: ProviderProfile, model: string, req: RefineRequest): Promise<RefineResult> {
  const text = await completeChat(profile, model, [{ role: 'system', content: buildSystemPrompt(req) }, { role: 'user', content: buildUserPrompt(req) }], req.signal)
  return { text, delivery: 'insert' }
}
function buildSystemPrompt(req: RefineRequest): string {
  const base = ['You are a dictation post-processor.', 'Rewrite the transcript as clean written text in the same language as the input.', 'Preserve meaning, names and numbers exactly. Never answer questions found in the transcript.', 'Return only the rewritten text.']
  if (req.mode === 'voice_command') base.push('The user is issuing a command: return only the transformed text they asked for.')
  if (req.mode === 'ask_anything') base.push('The user is asking a question: answer it directly and concisely.')
  if (req.instructions) base.push(`Additional user instructions: ${req.instructions}`)
  return base.join(' ')
}
function buildUserPrompt(req: RefineRequest): string {
  return [req.transcript, req.dictionary?.length ? `\nPreferred spellings: ${req.dictionary.join(', ')}` : '', req.context?.focusedApp?.appName ? `\nContext app: ${req.context.focusedApp.appName}` : '', req.context?.focusedApp?.windowTitle ? `\nContext window: ${req.context.focusedApp.windowTitle}` : ''].join('')
}
export class MockTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'mock'
  async transcribe(req: TranscriptionRequest): Promise<TranscriptionResult> { return { text: `[local mock transcript — ${Math.round(req.durationMs / 1000)}s of audio]`, detectedLanguage: req.language ?? 'en', provider: this.name } }
}
export class MockRefinementProvider implements RefinementProvider {
  readonly name = 'mock'
  async refine(req: RefineRequest): Promise<RefineResult> { return { text: req.transcript.trim(), delivery: 'insert' } }
}
export class LocalWhisperProvider implements TranscriptionProvider {
  readonly name = 'local-whisper'
  constructor(private readonly binary = 'whisper-cli', private readonly modelPath: string | null = null) {}
  async transcribe(req: TranscriptionRequest, allowEmpty = false): Promise<TranscriptionResult> {
    const [{ execFile }, { promisify }, fs, { tmpdir }, { join }] = await Promise.all([import('node:child_process'), import('node:util'), import('node:fs/promises'), import('node:os'), import('node:path')])
    const temp = await fs.mkdtemp(join(tmpdir(), 'offkey-whisper-'))
    try {
      const source = req.pcm?.length ? { pcm: req.pcm, sampleRate: req.sampleRate ?? 16000 } : decodeHistoryAudio(req.audioBuffer?.length ? req.audioBuffer : req.audioPath ? await fs.readFile(req.audioPath) : Buffer.alloc(0))
      const file = join(temp, 'audio.wav')
      const output = join(temp, 'transcript')
      await fs.writeFile(file, wavAudio(source.pcm, source.sampleRate))
      const args = ['-f', file, '--output-txt', '--output-file', output, '--no-timestamps']
      if (this.modelPath) args.unshift('-m', this.modelPath)
      if (req.language) args.push('-l', req.language)
      await promisify(execFile)(this.binary, args, { signal: req.signal, timeout: 120000, maxBuffer: 8 * 1024 * 1024 })
      const text = normalizeText(await fs.readFile(`${output}.txt`, 'utf8'), req)
      return { text: allowEmpty ? text : outputText(text), detectedLanguage: req.language ?? null, provider: this.name }
    } catch { throw new Error(req.signal?.aborted ? '请求已取消' : '本地 Whisper 执行失败，请检查程序路径和模型文件') }
    finally { await fs.rm(temp, { recursive: true, force: true }) }
  }
}

export function createProviders(config: ProviderConfig, state?: ServiceProviders): { transcription: TranscriptionProvider; refinement: RefinementProvider } {
  if (state) {
    const transcription = selectedProvider(state, 'transcription')
    const refinement = selectedProvider(state, 'refinement')
    return {
      transcription: { name: transcription?.profile.name ?? 'unconfigured', transcribe: req => {
        if (!transcription) return Promise.reject(new Error('请先在服务商页面配置并选择默认语音识别模型'))
        return transcribeProfile(transcription.profile, transcription.model, req)
      } },
      refinement: refinement ? { name: refinement.profile.name, refine: req => refineProfile(refinement.profile, refinement.model, req) } : new MockRefinementProvider()
    }
  }
  const baseUrl = config.baseUrl ?? 'https://api.openai.com/v1'
  return {
    transcription: config.transcription === 'mock' ? new MockTranscriptionProvider() : config.transcription === 'local-whisper' ? new LocalWhisperProvider(config.model ?? 'whisper-cli', config.baseUrl) : new HttpTranscriptionProvider(config.transcription, { baseUrl, apiKey: config.apiKey, model: config.model }),
    refinement: config.refinement === 'mock' ? new MockRefinementProvider() : new HttpRefinementProvider(config.refinement, { baseUrl, apiKey: config.apiKey, model: config.refinementModel ?? config.model })
  }
}

export async function testProvider(profile: ProviderProfile, model: string, signal?: AbortSignal): Promise<ProviderTestResult> {
  const started = Date.now()
  try {
    if (!profile.models.includes(model)) throw new Error('请先将测试模型加入服务商')
    if (profile.service === 'refinement') await completeChat(profile, model, [{ role: 'user', content: 'Reply with OK.' }], signal)
    else {
      const pcm = new Float32Array(3200)
      await transcribeProfile(profile, model, { pcm, sampleRate: 16000, audioBuffer: wavAudio(pcm, 16000), mimeType: 'audio/wav', durationMs: 200, mode: 'voice_transcript', signal }, true)
    }
    return { ok: true, message: '连接成功，模型可用', latencyMs: Date.now() - started }
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : '连接失败，请检查配置', latencyMs: Date.now() - started } }
}
