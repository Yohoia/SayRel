import OpusScript from 'opusscript'

export function pcm16(pcm: Float32Array): Buffer {
  const out = Buffer.alloc(pcm.length * 2)
  for (let i = 0; i < pcm.length; i++) {
    const sample = Math.max(-1, Math.min(1, pcm[i]))
    out.writeInt16LE(Math.round(sample < 0 ? sample * 32768 : sample * 32767), i * 2)
  }
  return out
}

export function wavAudio(pcm: Float32Array, sampleRate: number): Buffer {
  const data = pcm16(pcm)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

/** Decode the mono Ogg/Opus history format produced by Sayrel, including older headerless recordings. */
export function decodeHistoryAudio(audio: Buffer): { pcm: Float32Array; sampleRate: number } {
  const packets: Buffer[] = []
  let chunks: Buffer[] = []
  let offset = 0
  let preSkip = 0
  let hasHeader = false
  let endGranule: number | null = null
  while (offset < audio.length) {
    if (offset + 27 > audio.length || audio.toString('ascii', offset, offset + 4) !== 'OggS') throw new Error("The saved audio format is invalid")
    const count = audio[offset + 26]
    if (offset + 27 + count > audio.length) throw new Error("The saved audio is incomplete")
    let cursor = offset + 27 + count
    for (let i = 0; i < count; i++) {
      const size = audio[offset + 27 + i]
      if (cursor + size > audio.length) throw new Error("The saved audio is incomplete")
      chunks.push(audio.subarray(cursor, cursor + size))
      cursor += size
      if (size < 255) {
        const packet = Buffer.concat(chunks)
        chunks = []
        if (packet.subarray(0, 8).toString() === 'OpusHead') {
          if (packet.length < 19 || packet[9] !== 1) throw new Error("Saved audio must be mono")
          preSkip = Math.round(packet.readUInt16LE(10) / 3)
          hasHeader = true
        } else if (packet.subarray(0, 8).toString() !== 'OpusTags') packets.push(packet)
      }
    }
    if (hasHeader && (audio[offset + 5] & 0x04)) endGranule = Number(audio.readBigUInt64LE(offset + 6))
    offset = cursor
  }
  if (chunks.length || !packets.length) throw new Error("No usable audio was found in this recording")
  const decoder = new OpusScript(16000, 1, OpusScript.Application.AUDIO)
  try {
    const decoded = Buffer.concat(packets.map(packet => decoder.decode(packet)))
    const available = Math.max(0, decoded.length / 2 - preSkip)
    const length = endGranule === null ? available : Math.min(available, Math.max(0, Math.round(endGranule / 3) - preSkip))
    const pcm = new Float32Array(length)
    for (let i = 0; i < pcm.length; i++) pcm[i] = decoded.readInt16LE((i + preSkip) * 2) / 32768
    return { pcm, sampleRate: 16000 }
  } catch { throw new Error("Could not decode the saved audio. Please record again.") }
  finally { decoder.delete() }
}
