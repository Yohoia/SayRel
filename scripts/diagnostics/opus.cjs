// Real Worker and codec, synthetic audio only. macOS also verifies with Core Audio.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { Worker } = require('node:worker_threads'), { spawnSync } = require('node:child_process')
const { build } = require('esbuild')
const root = path.resolve(__dirname, '../..')
fs.mkdirSync(path.join(root, '.build'), { recursive: true })
const temporary = fs.mkdtempSync(path.join(root, '.build/opus-regression-'))
let worker, requestId = 0
function encode(samples, sampleRate = 16000, channels = 1) {
  const pcm = Float32Array.from({ length: samples * channels }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 440 * Math.floor(i / channels) / sampleRate))
  return new Promise((resolve, reject) => {
    worker.once('message', result => result.ok ? resolve(Buffer.from(result.ogg)) : reject(new Error(result.error)))
    worker.postMessage({ id: String(requestId++), method: 'encode', pcm: pcm.buffer, sampleRate, channels, bitrate: 32000, vbr: true })
  })
}
function pages(audio) {
  const out = []
  for (let offset = 0; offset < audio.length;) {
    assert.equal(audio.toString('ascii', offset, offset + 4), 'OggS')
    const count = audio[offset + 26], header = 27 + count
    let body = 0
    for (let i = 0; i < count; i++) body += audio[offset + 27 + i]
    const page = Buffer.from(audio.subarray(offset, offset + header + body))
    const expected = page.readUInt32LE(22)
    page.writeUInt32LE(0, 22)
    let crc = 0
    for (const byte of page) {
      crc = (crc ^ (byte << 24)) >>> 0
      for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x80000000 ? 0x04c11db7 : 0)) >>> 0
    }
    assert.equal(crc, expected, 'Ogg checksum')
    out.push({ flags: page[5], granule: Number(page.readBigUInt64LE(6)), sequence: page.readUInt32LE(18), serial: page.readUInt32LE(14), packet: page.subarray(header) })
    offset += page.length
  }
  return out
}
async function main() {
  await build({ entryPoints: [path.join(root, 'src/main/workers/opusWorker.ts')], outfile: path.join(temporary, 'worker.mjs'), platform: 'node', format: 'esm', bundle: true, packages: 'external' })
  const audioModule = path.join(temporary, 'audio.cjs')
  await build({ entryPoints: [path.join(root, 'src/main/services/providers/audio.ts')], outfile: audioModule, platform: 'node', format: 'cjs', bundle: true, packages: 'external' })
  const { decodeHistoryAudio } = require(audioModule)
  worker = new Worker(path.join(temporary, 'worker.mjs'), { workerData: { sampleRate: 16000, channels: 1 }, execArgv: [] })
  worker.on('error', error => { console.error(error); process.exitCode = 1 })
  const fixtures = [[16001, 16000, 1], [16682, 16000, 1], [16000, 16000, 1], [1, 16000, 1], [0, 16000, 1], [48001, 48000, 2], [8001, 8000, 1], [12001, 12000, 1], [24001, 24000, 1]]
  for (const [samples, rate, channels] of fixtures) {
    const audio = await encode(samples, rate, channels), stream = pages(audio)
    assert.equal(stream[0].packet.subarray(0, 8).toString(), 'OpusHead')
    assert.equal(stream[0].flags, 2)
    assert.equal(stream[1].packet.subarray(0, 8).toString(), 'OpusTags')
    assert.equal(stream.at(-1).flags, 4)
    const preSkip = stream[0].packet.readUInt16LE(10)
    assert.equal(stream.at(-1).granule - preSkip, samples * 48000 / rate)
    stream.forEach((page, index) => {
      assert.equal(page.sequence, index)
      assert.equal(page.serial, stream[0].serial)
      if (index) assert.ok(page.granule >= stream[index - 1].granule)
    })
    if (rate === 16000 && channels === 1) assert.equal(decodeHistoryAudio(audio).pcm.length, samples, 'history retry must trim encoder padding')
    if (process.platform === 'darwin' && samples > 0) {
      const input = path.join(temporary, 'sample.ogg'), output = path.join(temporary, 'sample.wav')
      fs.writeFileSync(input, audio)
      const result = spawnSync('/usr/bin/afconvert', [input, output, '-f', 'WAVE', '-d', 'LEI16@' + rate], { encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
      const wav = fs.readFileSync(output)
      let offset = 12, decodedBytes
      while (offset + 8 <= wav.length) {
        const length = wav.readUInt32LE(offset + 4)
        if (wav.toString('ascii', offset, offset + 4) === 'data') { decodedBytes = length; break }
        offset += 8 + length + length % 2
      }
      assert.equal(decodedBytes, samples * channels * 2, 'independent decoder must preserve exact recording length')
    }
  }
  const first = await encode(16001), second = await encode(16001)
  assert.deepEqual(pages(first).map(p => p.packet), pages(second).map(p => p.packet), 'recordings must not inherit previous encoder state')
  console.log('PASS arbitrary tails, valid Ogg headers/checksums/EOS, all Opus rates, stereo, exact history length and independent decode')
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  await worker?.terminate()
  fs.rmSync(temporary, { recursive: true, force: true })
})
