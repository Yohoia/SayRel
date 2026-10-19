import { workerThreads } from '../lib/workers'
import { createLogger } from '../lib/logger'
import { AUDIO } from '../../shared/constants'
import type { TranscriptionRequest, TranscriptionResult } from '../../shared/types'
import type { Mode } from '../../shared/constants'
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
}

/**
 * Encodes PCM to Ogg/Opus on a worker thread, then runs the configured
 * transcription provider. Encoding failures fall back to sending raw PCM so a
 * provider that accepts WAV still works.
 */
export async function transcribe(options: TranscribeOptions): Promise<{
  result: TranscriptionResult
  ogg: Buffer
}> {
  const started = Date.now()
  let ogg: Buffer = Buffer.alloc(0)

  if (options.pcm?.length) {
    const encoded = await workerThreads.encodeOpus({
      pcm: options.pcm,
      sampleRate: AUDIO.SAMPLE_RATE,
      channels: AUDIO.CHANNELS,
      bitrate: AUDIO.BITRATE_BPS
    })
    ogg = encoded.ogg
  }

  const settings = await import('../lib/settings').then((m) => m.settings.get())
  const { transcription } = createProviders(settings.provider)

  const result = await transcription.transcribe({
    audioBuffer: ogg,
    audioPath: options.audioPath ?? null,
    mimeType: 'audio/ogg',
    durationMs: options.durationMs,
    language: options.language ?? settings.transcriptionLanguage,
    languages: settings.preferredLanguages,
    dictionary: options.dictionary,
    context: options.context ?? null,
    mode: options.mode
  })

  log.info(`transcribed in ${Date.now() - started}ms via ${result.provider}`)
  return { result, ogg }
}
