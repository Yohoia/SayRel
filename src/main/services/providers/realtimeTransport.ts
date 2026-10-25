import { WebSocket } from 'undici'
import { setTimeout as sleep } from 'node:timers/promises'
import type { TranscriptionResult } from '../../../shared/types'
import { ProviderError } from './transport'

export type SendAudio = (message: string | Buffer) => void
export interface RealtimeProtocol {
  begin(send: SendAudio): void
  receive(message: string | Buffer): { ready?: boolean; done?: boolean; partial?: string }
  audio(chunk: Buffer, last: boolean, send: SendAudio): void
  finish(send: SendAudio): void
  finishLive?(send: SendAudio): void
  result(): Pick<TranscriptionResult, 'text' | 'detectedLanguage' | 'providerPolish'>
}

export interface LiveTranscriptionSession {
  result: Promise<TranscriptionResult>
  pushPcm(chunk: Float32Array): void
  finish(): Promise<TranscriptionResult>
  abort(): void
}

/** Carries fractional sample positions across recorder chunks, including the final sample. */
export class StreamingPcm16 {
  private pending = new Float32Array()
  private sourceOffset = 0
  private totalInput = 0
  private emitted = 0
  constructor(private readonly inputRate: number, private readonly outputRate: number) {}
  encode(chunk: Float32Array, final = false): Buffer {
    if (chunk.some(sample => !Number.isFinite(sample))) throw new ProviderError('The recording contains invalid audio samples')
    const input = new Float32Array(this.pending.length + chunk.length)
    input.set(this.pending); input.set(chunk, this.pending.length)
    this.totalInput += chunk.length
    const ratio = this.inputRate / this.outputRate, output: number[] = []
    const targetCount = final ? Math.round(this.totalInput / ratio)
      : ratio >= 1 ? Math.floor(this.totalInput / ratio) : Math.max(0, Math.ceil((this.totalInput - 1) / ratio))
    while (this.emitted < targetCount) {
      const position = this.emitted * ratio - this.sourceOffset
      let sample: number
      if (ratio > 1) {
        const end = Math.min(position + ratio, input.length)
        let sum = 0
        for (let index = Math.floor(position); index < Math.ceil(end); index++) sum += input[index] * (Math.min(index + 1, end) - Math.max(index, position))
        sample = sum / (end - position)
      } else {
        const left = Math.floor(position), right = Math.min(left + 1, input.length - 1)
        sample = input[left] + (input[right] - input[left]) * (position - left)
      }
      const value = Math.max(-1, Math.min(1, sample))
      output.push(Math.round(value < 0 ? value * 32768 : value * 32767))
      this.emitted++
    }
    const consumed = Math.min(Math.floor(this.emitted * ratio) - this.sourceOffset, input.length)
    this.pending = input.slice(consumed); this.sourceOffset += consumed
    const buffer = Buffer.alloc(output.length * 2)
    output.forEach((sample, index) => buffer.writeInt16LE(sample, index * 2))
    return buffer
  }
}

export function openRealtimeTransport(options: {
  url: URL; headers: Record<string, string>; session: RealtimeProtocol; sampleRate: number; inputRate: number
  readyOnOpen: boolean; provider: string; signal?: AbortSignal; onPartial?: (text: string) => void
  onReady?: () => void
}): LiveTranscriptionSession {
  const socket = new WebSocket(options.url, { headers: options.headers })
  socket.binaryType = 'arraybuffer'
  const encoder = new StreamingPcm16(options.inputRate, options.sampleRate)
  const queue: Buffer[] = []
  const draining = new AbortController()
  let queuedBytes = 0, ready = false, ended = false, sealed = false, settled = false, pumping = false
  let resolveResult: (value: TranscriptionResult) => void = () => {}
  let rejectResult: (error: Error) => void = () => {}
  const result = new Promise<TranscriptionResult>((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
  // The recorder owns error reporting/fallback; never leave a rejection unobserved during capture.
  void result.catch(() => {})
  const connectTimer = setTimeout(() => fail(new ProviderError('The realtime connection or configuration was not confirmed.')), 15_000)
  const sessionTimer = setTimeout(() => fail(new ProviderError('Realtime transcription timed out.')), 360_000)
  let finalTimer: ReturnType<typeof setTimeout> | undefined
  const onAbort = (): void => fail(new ProviderError('Request cancelled'))

  function cleanup(): void {
    clearTimeout(connectTimer); clearTimeout(sessionTimer); clearTimeout(finalTimer)
    draining.abort(); options.signal?.removeEventListener('abort', onAbort)
    queue.length = 0; queuedBytes = 0
    socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null
    try { socket.close() } catch { /* A failed connection may not have opened. */ }
  }
  function fail(error: unknown): void {
    if (settled) return
    settled = true; cleanup()
    rejectResult(error instanceof Error ? error : new ProviderError('Realtime transcription failed'))
  }
  const send: SendAudio = message => {
    if (settled || socket.readyState !== WebSocket.OPEN) throw new ProviderError('The realtime connection was closed')
    socket.send(message)
  }
  function markReady(): void {
    if (!ready) { ready = true; clearTimeout(connectTimer); options.onReady?.() }
    void pump()
  }
  async function pump(): Promise<void> {
    if (pumping || !ready || settled) return
    pumping = true
    try {
      while (queue.length && !settled) {
        while (socket.bufferedAmount > 256 * 1024) await sleep(20, undefined, { signal: draining.signal })
        if (settled) return
        const chunk = queue.shift()
        if (!chunk) break
        queuedBytes -= chunk.length
        options.session.audio(chunk, false, send)
      }
      if (ended && !sealed && !settled) {
        sealed = true
        if (options.session.finishLive) options.session.finishLive(send)
        else options.session.finish(send)
      }
    } catch (error) { fail(error) }
    finally { pumping = false }
  }
  function enqueue(buffer: Buffer): void {
    const bytesPerChunk = options.sampleRate / 5 * 2
    for (let offset = 0; offset < buffer.length; offset += bytesPerChunk) queue.push(buffer.subarray(offset, offset + bytesPerChunk))
    queuedBytes += buffer.length
    if (queuedBytes + socket.bufferedAmount > options.sampleRate * 2 * 15) {
      fail(new ProviderError('The realtime connection fell behind audio capture.'))
      return
    }
    void pump()
  }
  socket.onopen = () => {
    try {
      options.session.begin(send)
      if (options.readyOnOpen) markReady()
    } catch (error) { fail(error) }
  }
  socket.onmessage = event => {
    try {
      const data: unknown = event.data
      if (typeof data !== 'string' && !(data instanceof ArrayBuffer)) throw new ProviderError('Invalid realtime protocol message')
      const update = options.session.receive(typeof data === 'string' ? data : Buffer.from(data))
      if (update.done) {
        if (!sealed) throw new ProviderError('The provider ended transcription before recording finished')
        const value = options.session.result()
        settled = true; cleanup(); resolveResult({ ...value, provider: options.provider })
      } else {
        if (update.partial !== undefined) options.onPartial?.(update.partial)
        if (update.ready) markReady()
      }
    } catch (error) { fail(error) }
  }
  socket.onerror = () => fail(new ProviderError('The realtime connection failed. Check the network and provider settings.'))
  socket.onclose = () => fail(new ProviderError('The realtime connection closed before returning a final transcript.'))
  options.signal?.addEventListener('abort', onAbort, { once: true })
  if (options.signal?.aborted) onAbort()
  return {
    result,
    pushPcm(chunk) { if (!settled && !ended) { try { enqueue(encoder.encode(chunk)) } catch (error) { fail(error) } } },
    finish() {
      if (!settled && !ended) {
        ended = true
        finalTimer = setTimeout(() => fail(new ProviderError('Realtime transcription timed out waiting for the final result.')), 45_000)
        try { enqueue(encoder.encode(new Float32Array(), true)); void pump() } catch (error) { fail(error) }
      }
      return result
    },
    abort: onAbort
  }
}
