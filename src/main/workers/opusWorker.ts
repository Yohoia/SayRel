/** Encodes each recording as an independent, sample-accurate Ogg/Opus stream. */
import { parentPort } from 'node:worker_threads'
import OpusScript from 'opusscript'
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
    writePacket(packet: Uint8Array, granule: number, flags = 0) {
      pages.push(page([packet], BigInt(granule), flags))
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

function opusSampleRate(value: number): ConstructorParameters<typeof OpusScript>[0] {
  switch (value) {
    case 8000: case 12000: case 16000: case 24000: case 48000: return value
    default: throw new Error('Unsupported Opus sample rate')
  }
}

function encodeBuffer(req: EncodeRequest): EncodeResponse {
  const started = performance.now()
  const rate = opusSampleRate(req.sampleRate)
  if (req.channels !== 1 && req.channels !== 2) throw new Error('Opus requires mono or stereo PCM')
  const pcm = new Float32Array(req.pcm)
  if (pcm.length % req.channels !== 0) throw new Error('Incomplete interleaved PCM sample')
  const int16 = pcmToInt16(pcm)
  const enc = new OpusScript(rate, req.channels, OpusScript.Application.AUDIO)
  try {
    enc.setBitrate(req.bitrate)
    enc.encoderCTL(4006, req.vbr ? 1 : 0)
    const frameSize = rate / 50
    // OpusScript's libopus AUDIO mode adds 6.5 ms of lookahead, expressed at 48 kHz.
    const preSkip = 312
    const lookahead = preSkip * rate / 48000
    const samples = pcm.length / req.channels
    const frames = Math.ceil((samples + lookahead) / frameSize)
    const writer = oggWriter((Math.random() * 0xffffffff) >>> 0)
    writer.writePacket(opusHead(req.channels, rate, preSkip), 0, 0x02)
    writer.writePacket(opusTags(), 0)
    const frame = new Int16Array(frameSize * req.channels)
    for (let index = 0; index < frames; index++) {
      const offset = index * frame.length
      frame.fill(0)
      frame.set(int16.subarray(offset, offset + frame.length))
      const packet = enc.encode(Buffer.from(frame.buffer), frameSize)
      const last = index === frames - 1
      const granule = last ? samples * 48000 / rate + preSkip : (index + 1) * frameSize * 48000 / rate
      writer.writePacket(new Uint8Array(packet), granule, last ? 0x04 : 0)
    }
    return {
      id: req.id, ok: true, ogg: writer.finish(),
      durationMs: Math.round(samples / rate * 1000),
      encodingTime: Math.round(performance.now() - started)
    }
  } finally {
    enc.delete()
  }
}

parentPort?.on('message', (req: EncodeRequest) => {
  if (req.method !== 'encode') return
  try {
    parentPort?.postMessage(encodeBuffer(req))
  } catch (error) {
    parentPort?.postMessage({ id: req.id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies EncodeResponse)
  }
})
