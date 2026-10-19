import { workerThreads } from '../lib/workers'
import { util } from '../lib/native'
import { invalidateAudioDevices, listAudioDevices } from '../services/audioDevices'
import { AUDIO } from '../../shared/constants'
import type { Handler } from './index'

export function registerAudioHandlers(handle: (c: string, f: Handler) => void): void {
  handle('audio:get-devices-async', async () => {
    invalidateAudioDevices()
    return listAudioDevices(true)
  })

  handle('audio:is-muted', () => Boolean(util.isAudioMuted?.()))
  handle('audio:mute', () => util.muteAudio?.())
  handle('audio:unmute', () => util.unmuteAudio?.())

  handle('audio:opus-compress-by-buffer', async (_e, payload: any) => {
    const pcm = toFloat32(payload?.pcm)
    const result = await workerThreads.opus.encodeOpus({
      pcm,
      sampleRate: payload?.sampleRate ?? AUDIO.SAMPLE_RATE,
      channels: payload?.channels ?? AUDIO.CHANNELS,
      bitrate: payload?.bitrate ?? AUDIO.BITRATE_BPS
    })
    return { ...result, ogg: result.ogg.buffer }
  })

  handle('audio:opus-compress-by-audio-id', async (_e, audioId: string, payload: any) => {
    const pcm = toFloat32(payload?.pcm)
    const started = await workerThreads.chunks.start(audioId, payload)
    if (!started?.ok) throw new Error(started?.error ?? 'session start failed')
    await workerThreads.chunks.encode(audioId, pcm)
    const { packets, durationMs } = await workerThreads.chunks.end(audioId)
    return { ogg: packets, durationMs }
  })

  handle('audio:opus-chunk-session-start', async (_e, audioId: string, opts?: unknown) => {
    return workerThreads.chunks.start(audioId, (opts ?? {}) as any)
  })

  handle('audio:opus-chunk-session-encode', async (_e, audioId: string, pcmLike: any) => {
    return workerThreads.chunks.encode(audioId, toFloat32(pcmLike))
  })

  handle('audio:opus-chunk-session-end', async (_e, audioId: string) => {
    const { packets } = await workerThreads.chunks.end(audioId)
    return { ogg: packets }
  })

  handle('audio:clean-opus-audio-file', async () => {
    // Temporary opus files are cleaned by the worker; nothing else to do.
    return true
  })

  handle('audio:ai-voice-flow', async () => {
    throw new Error('ai voice flow is handled by the recording machine')
  })

  handle('audio:abort-ai-voice-flow-request', async () => true)
}

function toFloat32(input: any): Float32Array {
  if (input instanceof Float32Array) return input
  if (input instanceof ArrayBuffer) return new Float32Array(input)
  if (ArrayBuffer.isView(input)) {
    return new Float32Array(input.buffer, input.byteOffset, (input as any).length / 4)
  }
  if (Array.isArray(input)) return Float32Array.from(input)
  return new Float32Array(0)
}
