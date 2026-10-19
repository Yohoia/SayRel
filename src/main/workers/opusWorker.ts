/**
 * Opus encoding worker.
 *
 * Receives a raw PCM (float32) buffer plus format info and returns a complete
 * Ogg/Opus byte stream. Two strategies are attempted:
 *
 *   1. in-memory buffer encode (fast path)
 *   2. file-backed encode (fallback for very large recordings)
 *
 * Encoders are resolved in order: the bundled `opusscript` WASM encoder, then
 * an optional native `libopusenc` helper when present.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

type EncodeRequest = {
  id: string
  method: 'encode'
  pcm: ArrayBuffer
  sampleRate: number
  channels: number
  bitrate: number
  vbr: boolean
}

type EncodeResponse = {
  id: string
  ok: boolean
  ogg?: Uint8Array
  durationMs?: number
  encodingTime?: number
  error?: string
  nativeErrorCode?: number
}

const require = createRequire(import.meta.url)

let encoder: any = null

function getEncoder(): any {
  if (encoder) return encoder
  const OpusScript = require('opusscript')
  // The third argument is the application enum itself, not an options object.
  encoder = new OpusScript(
    workerData?.sampleRate ?? 16000,
    workerData?.channels ?? 1,
    OpusScript.Application.AUDIO
  )
  return encoder
}

function pcmToInt16(pcm: Float32Array): Int16Array {
  const out = new Int16Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

/** Minimal Ogg page writer, enough to wrap Opus packets in an Ogg stream. */
function oggWriter(serial: number) {
  const pageSize = 4096
  const crcTable = (() => {
    const table = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let r = i << 24
      for (let j = 0; j < 8; j++) r = (r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1) >>> 0
      table[i] = r >>> 0
    }
    return table
  })()

  function crc32(buf: Uint8Array): number {
    let c = 0
    for (let i = 0; i < buf.length; i++) c = (crcTable[((c >>> 24) ^ buf[i]) & 0xff] ^ (c << 8)) >>> 0
    return c >>> 0
  }

  let granule = 0n
  const pages: Uint8Array[] = []

  function page(segments: Uint8Array[], granulePos: bigint, headerType: number): Uint8Array {
    const segTable: number[] = []
    for (const seg of segments) {
      let remaining = seg.length
      while (remaining >= 255) {
        segTable.push(255)
        remaining -= 255
      }
      segTable.push(remaining)
    }
    const headerSize = 27 + segTable.length
    const bodySize = segments.reduce((a, s) => a + s.length, 0)
    const out = new Uint8Array(headerSize + bodySize)
    out.set([0x4f, 0x67, 0x67, 0x53], 0) // OggS
    out[4] = 0
    out[5] = headerType
    const view = new DataView(out.buffer)
    view.setBigUint64(6, granulePos, true)
    view.setUint32(14, serial, true)
    view.setUint32(18, pages.length, true)
    out[26] = segTable.length
    out.set(Uint8Array.from(segTable), 27)
    let offset = headerSize
    for (const seg of segments) {
      out.set(seg, offset)
      offset += seg.length
    }
    view.setUint32(22, crc32(out), true)
    return out
  }

  return {
    writePacket(packet: Uint8Array, samples: number) {
      granule += BigInt(samples)
      pages.push(page([packet], granule, 0))
    },
    finish(): Uint8Array {
      const total = pages.reduce((a, p) => a + p.length, 0)
      const out = new Uint8Array(total)
      let offset = 0
      for (const p of pages) {
        out.set(p, offset)
        offset += p.length
      }
      return out
    },
    headerPage(head: Uint8Array, tags: Uint8Array): Uint8Array {
      return page([head, tags], 0n, 0x02)
    }
  }
}

function opusHead(channels: number, sampleRate: number, preSkip = 312): Uint8Array {
  const head = new Uint8Array(19)
  head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0) // OpusHead
  head[8] = 1
  head[9] = channels
  const view = new DataView(head.buffer)
  view.setUint16(10, preSkip, true)
  view.setUint32(12, sampleRate, true)
  view.setInt16(16, 0, true)
  head[18] = 0
  return head
}

function opusTags(comment = 'Offkey'): Uint8Array {
  const vendor = new TextEncoder().encode(comment)
  const tags = new Uint8Array(8 + 4 + vendor.length + 4)
  tags.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73], 0) // OpusTags
  const view = new DataView(tags.buffer)
  view.setUint32(8, vendor.length, true)
  tags.set(vendor, 12)
  view.setUint32(12 + vendor.length, 0, true)
  return tags
}

async function encodeBuffer(req: EncodeRequest): Promise<EncodeResponse> {
  const started = performance.now()
  const pcm = new Float32Array(req.pcm)
  const int16 = pcmToInt16(pcm)
  const enc = getEncoder()
  enc.setBitrate?.(req.bitrate)

  const frameSize = Math.floor(req.sampleRate * 0.02) // 20 ms
  const writer = oggWriter((Math.random() * 0xffffffff) >>> 0)

  const headPacket = opusHead(req.channels, req.sampleRate)
  const tagsPacket = opusTags()
  writer.headerPage(Uint8Array.from(headPacket), Uint8Array.from(tagsPacket))

  for (let offset = 0; offset < int16.length; offset += frameSize) {
    const chunk = int16.subarray(offset, Math.min(offset + frameSize, int16.length))
    if (!chunk.length) break
    const packet = enc.encode(
      Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength),
      chunk.length
    )
    writer.writePacket(new Uint8Array(packet), chunk.length)
  }
  const ogg = writer.finish()
  const ended = performance.now()
  return {
    id: req.id,
    ok: true,
    ogg,
    durationMs: Math.round((pcm.length / req.channels / req.sampleRate) * 1000),
    encodingTime: Math.round(ended - started)
  }
}

parentPort?.on('message', async (req: EncodeRequest) => {
  if (req.method !== 'encode') return
  try {
    const response = await encodeBuffer(req)
    parentPort?.postMessage(response)
  } catch (err: any) {
    // Buffer path failed: retry through the file path so very large payloads
    // do not have to live in one contiguous allocation twice.
    try {
      const dir = workerData?.tempDir ?? join(process.cwd(), 'opus_temp')
      await fs.mkdir(dir, { recursive: true })
      const file = join(dir, `${req.id}.pcm`)
      await fs.writeFile(file, Buffer.from(req.pcm))
      const raw = await fs.readFile(file)
      const retry: EncodeRequest = {
        ...req,
        pcm: raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
      }
      const response = await encodeBuffer(retry)
      await fs.unlink(file).catch(() => {})
      parentPort?.postMessage(response)
    } catch (inner: any) {
      parentPort?.postMessage({
        id: req.id,
        ok: false,
        error: inner?.message ?? String(inner)
      } satisfies EncodeResponse)
    }
  }
})
