import { Worker } from 'node:worker_threads'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { paths } from './paths'
import { createLogger } from './logger'
import { AUDIO } from '../../shared/constants'

const log = createLogger('workers')

const here = dirname(fileURLToPath(import.meta.url))
const workerDir = join(here, 'worker')

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

class OpusWorkerClient {
  private worker: Worker | null = null
  private pending = new Map<string, Pending>()

  private ensure(): Worker {
    if (this.worker) return this.worker
    const file = join(workerDir, 'opusWorker.js')
    this.worker = new Worker(file, {
      workerData: {
        sampleRate: AUDIO.SAMPLE_RATE,
        channels: AUDIO.CHANNELS,
        tempDir: paths.opusTemp
      }
    })
    this.worker.on('message', (msg: any) => {
      const entry = this.pending.get(msg.id)
      if (!entry) return
      clearTimeout(entry.timer)
      this.pending.delete(msg.id)
      if (msg.ok) entry.resolve(msg)
      else entry.reject(new Error(msg.error ?? 'opus encode failed'))
    })
    this.worker.on('error', (err) => {
      log.error('opus worker error', err)
      for (const [, entry] of this.pending) {
        clearTimeout(entry.timer)
        entry.reject(err as Error)
      }
      this.pending.clear()
      this.worker = null
    })
    this.worker.on('exit', () => {
      this.worker = null
    })
    return this.worker
  }

  encodeOpus(input: {
    pcm: Float32Array
    sampleRate: number
    channels: number
    bitrate: number
  }): Promise<{ ogg: Buffer; durationMs: number; encodingTime: number }> {
    return new Promise((resolve, reject) => {
      const id = randomUUID()
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('opus encode timed out'))
      }, 60_000)
      this.pending.set(id, { resolve, reject, timer })

      const copy = input.pcm.slice()
      const worker = this.ensure()
      worker.postMessage(
        {
          id,
          method: 'encode',
          pcm: copy.buffer,
          sampleRate: input.sampleRate,
          channels: input.channels,
          bitrate: input.bitrate,
          vbr: true
        },
        [copy.buffer]
      )
    }).then((msg: any) => ({
      ogg: Buffer.from(msg.ogg),
      durationMs: msg.durationMs,
      encodingTime: msg.encodingTime
    }))
  }

  async terminate(): Promise<void> {
    await this.worker?.terminate()
    this.worker = null
  }
}

class ChunkSessionClient {
  private worker: Worker | null = null
  private pending = new Map<string, Pending>()

  private ensure(): Worker {
    if (this.worker) return this.worker
    this.worker = new Worker(join(workerDir, 'chunkSessionWorker.js'), {
      workerData: { libPath: paths.helpers }
    })
    this.worker.on('message', (msg: any) => {
      const entry = this.pending.get(msg.id)
      if (!entry) return
      clearTimeout(entry.timer)
      this.pending.delete(msg.id)
      msg.ok ? entry.resolve(msg) : entry.reject(new Error(msg.error ?? 'chunk session failed'))
    })
    this.worker.on('error', (err) => {
      for (const [, entry] of this.pending) {
        clearTimeout(entry.timer)
        entry.reject(err as Error)
      }
      this.pending.clear()
      this.worker = null
    })
    this.worker.on('exit', () => {
      this.worker = null
    })
    return this.worker
  }

  private call(payload: Record<string, unknown>, timeout = 30_000): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = randomUUID()
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('chunk session timed out'))
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      this.ensure().postMessage({ id, ...payload })
    })
  }

  start(audioId: string, opts: { sampleRate?: number; channels?: number; bitrateBps?: number } = {}) {
    return this.call({
      method: 'session_create',
      audioId,
      sampleRate: opts.sampleRate ?? AUDIO.SAMPLE_RATE,
      channels: opts.channels ?? AUDIO.CHANNELS,
      bitrateBps: opts.bitrateBps ?? AUDIO.BITRATE_BPS
    })
  }

  encode(audioId: string, pcm: Float32Array) {
    const copy = pcm.slice()
    return new Promise((resolve, reject) => {
      const id = randomUUID()
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('chunk encode timed out'))
      }, 30_000)
      this.pending.set(id, { resolve, reject, timer })
      this.ensure().postMessage({ id, method: 'session_encode', audioId, pcm: copy.buffer }, [copy.buffer])
    })
  }

  end(audioId: string) {
    return this.call({ method: 'session_end', audioId }).then((msg) => ({
      packets: Buffer.from(msg.packets),
      durationMs: msg.durationMs
    }))
  }

  setComplexity(audioId: string, complexity: number) {
    return this.call({ method: 'session_set_complexity', audioId, complexity })
  }

  estimateOutputSize(samples: number, channels: number, bitrateBps: number) {
    return this.call({ method: 'estimate_output_size', samples, channels, bitrateBps })
  }

  async terminate(): Promise<void> {
    await this.worker?.terminate()
    this.worker = null
  }
}

export const workerThreads = {
  opus: new OpusWorkerClient(),
  chunks: new ChunkSessionClient(),
  encodeOpus: (input: {
    pcm: Float32Array
    sampleRate: number
    channels: number
    bitrate: number
  }) => workerThreads.opus.encodeOpus(input),
  shutdown: async () => {
    await Promise.allSettled([workerThreads.opus.terminate(), workerThreads.chunks.terminate()])
  }
}
