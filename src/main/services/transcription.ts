import { readFile } from 'node:fs/promises'
import { workerThreads } from '../lib/workers'
import { createLogger } from '../lib/logger'
import { AUDIO, type Mode } from '../../shared/constants'
import type { TranscriptionRequest, TranscriptionResult } from '../../shared/types'
import type { Settings } from '../../shared/settings'
import { createProviders } from './providers'

const log = createLogger('transcription')
export interface TranscribeOptions {
  pcm?: Float32Array
  audioPath?: string | null
  durationMs: number
  language?: string | null
  dictionary?: string[]
  context?: TranscriptionRequest['context']
  mode: Mode
  config?: Settings
  signal?: AbortSignal
  onAudioEncoded?: (ogg: Buffer) => Promise<void>
  liveResult?: Promise<TranscriptionResult>
  onLiveFallback?: (error: unknown) => void
}

export function recognitionLanguage(config: Settings): string | null {
  return config.autoDetectLanguage ? null : config.transcriptionLanguage ?? config.preferredLanguages[0] ?? 'en'
}

export async function transcribe(options: TranscribeOptions): Promise<{ result: TranscriptionResult; ogg: Buffer }> {
  const started = Date.now()
  options.signal?.throwIfAborted()
  const config: Settings = options.config ?? (await import('../lib/settings')).settings.get()
  let ogg: Buffer = Buffer.alloc(0)
  if (options.pcm?.length && (!options.liveResult || config.historyEnabled && config.saveAudio)) {
    ogg = (await workerThreads.encodeOpus({ pcm: options.pcm, sampleRate: AUDIO.SAMPLE_RATE, channels: AUDIO.CHANNELS, bitrate: AUDIO.BITRATE_BPS })).ogg
  }
  const encodedAt = Date.now()
  options.signal?.throwIfAborted()
  if (ogg.length && options.onAudioEncoded) {
    await options.onAudioEncoded(ogg)
    options.signal?.throwIfAborted()
  }
  const persistedAt = Date.now()
  const audioBuffer = options.audioPath ? await readFile(options.audioPath) : ogg
  const providerStartedAt = Date.now()
  let result: TranscriptionResult | undefined
  if (options.liveResult) {
    try { result = await options.liveResult }
    catch (error) { options.signal?.throwIfAborted(); options.onLiveFallback?.(error) }
  }
  options.signal?.throwIfAborted()
  result ??= await createProviders(config.provider, config.serviceProviders).transcription.transcribe({
    audioBuffer, audioPath: options.audioPath ?? null, mimeType: 'audio/ogg', pcm: options.pcm, allowEmpty: true,
    sampleRate: AUDIO.SAMPLE_RATE, signal: options.signal, durationMs: options.durationMs,
    language: options.language === undefined ? recognitionLanguage(config) : options.language, languages: config.preferredLanguages,
    dictionary: options.dictionary, context: options.context ?? null, mode: options.mode
  })
  log.info('transcription completed', { provider: result.provider, audioDurationMs: options.durationMs,
    durationMs: Date.now() - started, encodingMs: encodedAt - started, persistenceMs: persistedAt - encodedAt,
    inputReadMs: providerStartedAt - persistedAt, providerMs: Date.now() - providerStartedAt, transcriptLength: result.text.length })
  return { result, ogg }
}
