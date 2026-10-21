/**
 * Preload Bridge - Audio Domain
 *
 * Handles audio recording, compression, and voice flow
 */

type Listener = (...args: unknown[]) => void

export function createAudioBridge(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
  subscribe: (channel: string, listener: Listener) => () => void
) {
  return {
    getDevices: () => invoke('audio:get-devices-async'),
    isMuted: () => invoke('audio:is-muted'),
    mute: () => invoke('audio:mute'),
    unmute: () => invoke('audio:unmute'),

    // Compression
    compressByBuffer: (payload: {
      pcm: ArrayBuffer
      sampleRate: number
      channels: number
      bitrate: number
    }) => invoke('audio:opus-compress-by-buffer', payload),

    compressByAudioId: (audioId: string, payload: unknown) =>
      invoke('audio:opus-compress-by-audio-id', audioId, payload),

    // Chunk encoding
    chunkSessionStart: (audioId: string, opts?: unknown) =>
      invoke('audio:opus-chunk-session-start', audioId, opts),

    chunkSessionEncode: (audioId: string, pcm: ArrayBuffer) =>
      invoke('audio:opus-chunk-session-encode', audioId, pcm),

    chunkSessionEnd: (audioId: string) =>
      invoke('audio:opus-chunk-session-end', audioId),

    cleanOpusFile: (path: string) =>
      invoke('audio:clean-opus-audio-file', path),

    // AI Voice Flow
    aiVoiceFlow: (payload: unknown) =>
      invoke('audio:ai-voice-flow', payload),

    abortAiVoiceFlow: (id: string) =>
      invoke('audio:abort-ai-voice-flow-request', id),

    onAiVoiceFlowStatus: (cb: Listener) =>
      subscribe('audio:ai-voice-flow', cb)
  }
}

export type AudioBridge = ReturnType<typeof createAudioBridge>
