/**
 * Streaming chunk-session worker.
 *
 * The floating bar records continuously and ships 100 ms PCM chunks. Encoding
 * each chunk in its own Ogg container would be wasteful, so a session keeps an
 * encoder alive for the whole recording and appends packets to one stream.
 * This worker offers the same session API when the host prefers to encode off
 * the main thread.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'

const require = createRequire(import.meta.url)

type Message =
  | { id: string; method: 'session_create'; audioId: string; sampleRate: number; channels: number; bitrateBps: number }
  | { id: string; method: 'session_encode'; audioId: string; pcm: ArrayBuffer }
  | { id: string; method: 'session_end'; audioId: string }
  | { id: string; method: 'session_set_complexity'; audioId: string; complexity: number }
  | { id: string; method: 'estimate_output_size'; samples: number; channels: number; bitrateBps: number }

type Session = {
  audioId: string
  encoder: any
  sampleRate: number
  channels: number
  packets: Uint8Array[]
  totalSamples: number
  startedAt: number
}

const sessions = new Map<string, Session>()

function createEncoder(sampleRate: number, channels: number, bitrate: number) {
  const OpusScript = require('opusscript')
  const enc = new OpusScript(sampleRate, channels, OpusScript.Application.AUDIO)
  enc.setBitrate?.(bitrate)
  return enc
}

function handle(msg: Message) {
  const started = performance.now()
  switch (msg.method) {
    case 'session_create': {
      sessions.set(msg.audioId, {
        audioId: msg.audioId,
        encoder: createEncoder(msg.sampleRate, msg.channels, msg.bitrateBps),
        sampleRate: msg.sampleRate,
        channels: msg.channels,
        packets: [],
        totalSamples: 0,
        startedAt: Date.now()
      })
      return { id: msg.id, ok: true, audioId: msg.audioId }
    }
    case 'session_encode': {
      const session = sessions.get(msg.audioId)
      if (!session) return { id: msg.id, ok: false, error: `No chunk session for audioId=${msg.audioId}` }
      const pcm = new Float32Array(msg.pcm)
      const int16 = new Int16Array(pcm.length)
      for (let i = 0; i < pcm.length; i++) {
        const s = Math.max(-1, Math.min(1, pcm[i]))
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
      }
      const frame = Math.floor(session.sampleRate * 0.02)
      for (let o = 0; o < int16.length; o += frame) {
        const chunk = int16.subarray(o, Math.min(o + frame, int16.length))
        session.packets.push(
          new Uint8Array(
            session.encoder.encode(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength), chunk.length)
          )
        )
        session.totalSamples += chunk.length
      }
      return {
        id: msg.id,
        ok: true,
        audioId: msg.audioId,
        samples: session.totalSamples,
        packets: session.packets.length,
        encodingTime: Math.round(performance.now() - started)
      }
    }
    case 'session_end': {
      const session = sessions.get(msg.audioId)
      if (!session) return { id: msg.id, ok: false, error: `No chunk session for audioId=${msg.audioId}` }
      const total = session.packets.reduce((a, p) => a + p.length, 0)
      const out = new Uint8Array(total)
      let offset = 0
      for (const p of session.packets) {
        out.set(p, offset)
        offset += p.length
      }
      sessions.delete(msg.audioId)
      return {
        id: msg.id,
        ok: true,
        audioId: msg.audioId,
        packets: out,
        durationMs: Math.round((session.totalSamples / session.channels / session.sampleRate) * 1000),
        encodingTime: Math.round(performance.now() - started)
      }
    }
    case 'session_set_complexity': {
      const session = sessions.get(msg.audioId)
      if (!session) return { id: msg.id, ok: false, error: `No chunk session for audioId=${msg.audioId}` }
      session.encoder.setComplexity?.(msg.complexity)
      return { id: msg.id, ok: true }
    }
    case 'estimate_output_size': {
      const bytes = Math.ceil(((msg.samples / msg.channels) / 16000) * (msg.bitrateBps / 8))
      return { id: msg.id, ok: true, size: bytes }
    }
    default:
      return { id: (msg as any).id, ok: false, error: `Unknown method: ${(msg as any).method}` }
  }
}

parentPort?.on('message', (msg: Message) => {
  try {
    const result = handle(msg)
    // Transfer encoded bytes instead of copying them.
    if (result && (result as any).packets instanceof Uint8Array) {
      parentPort?.postMessage(result, [(result as any).packets.buffer])
    } else {
      parentPort?.postMessage(result)
    }
  } catch (err: any) {
    parentPort?.postMessage({ id: msg.id, ok: false, error: err?.message ?? String(err) })
  }
})

export const workerMeta = {
  libPath: workerData?.libPath ?? null
}
