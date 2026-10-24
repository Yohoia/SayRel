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
}

export async function transcribe(options: TranscribeOptions): Promise<{ result: TranscriptionResult; ogg: Buffer }> {
  const started = Date.now()
  options.signal?.throwIfAborted()
  let ogg: Buffer = Buffer.alloc(0)
  if (options.pcm?.length) {
    ogg = (await workerThreads.encodeOpus({ pcm: options.pcm, sampleRate: AUDIO.SAMPLE_RATE, channels: AUDIO.CHANNELS, bitrate: AUDIO.BITRATE_BPS })).ogg
  }
  const encodedAt = Date.now()
  options.signal?.throwIfAborted()
  if (ogg.length && options.onAudioEncoded) {
    await options.onAudioEncoded(ogg)
    options.signal?.throwIfAborted()
  }
  const persistedAt = Date.now()
  const config: Settings = options.config ?? (await import('../lib/settings')).settings.get()
  const audioBuffer = options.audioPath ? await readFile(options.audioPath) : ogg
  const providerStartedAt = Date.now()
  const result = await createProviders(config.provider, config.serviceProviders).transcription.transcribe({
    audioBuffer, audioPath: options.audioPath ?? null, mimeType: 'audio/ogg', pcm: options.pcm,
    sampleRate: AUDIO.SAMPLE_RATE, signal: options.signal, durationMs: options.durationMs,
    language: options.language ?? config.transcriptionLanguage, languages: config.preferredLanguages,
    dictionary: options.dictionary, context: options.context ?? null, mode: options.mode
  })
  log.info('transcription completed', { provider: result.provider, audioDurationMs: options.durationMs,
    durationMs: Date.now() - started, encodingMs: encodedAt - started, persistenceMs: persistedAt - encodedAt,
    inputReadMs: providerStartedAt - persistedAt, providerMs: Date.now() - providerStartedAt, transcriptLength: result.text.length })
  return { result, ogg }
}
