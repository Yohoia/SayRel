// Explicit live evaluation with local synthetic speech; never reads user recordings.
const { app, safeStorage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { buildSync } = require('esbuild')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../../..')
const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const fixtures = [
  { id: 'correction', text: '明天下午三点去人民公园，不对，改成下午四点去市图书馆，在那里碰面。' },
  { id: 'todo', text: '周五之前有几件事。先网上值机，再收拾大行李箱，然后预订机场停车位。等等，先订停车位，便宜的位置很快就没了。行李箱的话，只住两晚，带登机箱就够了。' },
  { id: 'negation', text: '我不是说这个方案不能做，我是说现在不要上线。测试环境可以先跑，但生产环境必须等回滚方案准备好。' },
  { id: 'emphasis', text: '这个点很重要，很重要。请不要再删日志了。我重复一遍，不要再删日志了。需要清理的话，先找我确认。' }
]
if (!args.includes('--live') || !option('--profile') || !option('--label')) throw new Error('Usage: electron qwen31-live.cjs --live --profile <existing profile> --label <unique label> [--cases correction,todo,negation,emphasis]')
const label = option('--label')
if (!/^[a-zA-Z0-9-]{1,80}$/.test(label)) throw new Error('Invalid label')
const output = path.join(root, '.build/qwen31-evaluation', label)
if (fs.existsSync(output)) throw new Error('Preserve existing evidence; use a unique label')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sayrel-qwen31-evaluation-'))
app.setName('Sayrel')
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-background-networking')
app.whenReady().then(async () => {
  const selectedIds = option('--cases')?.split(',')
  const cases = fixtures.filter(fixture => !selectedIds || selectedIds.includes(fixture.id))
  if (!cases.length || selectedIds && cases.length !== selectedIds.length) throw new Error('Unknown fixture')
  fs.mkdirSync(output, { recursive: true })
  const runtime = path.join(output, 'runtime.cjs')
  buildSync({ stdin: { resolveDir: root, loader: 'ts', contents: `
    export {startLiveTranscription} from './src/main/services/providers/realtime';
    export {providerProfileSchema} from './src/shared/providers';
  ` }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: runtime, logLevel: 'silent' })
  const api = require(runtime)
  const settingsPath = path.resolve(option('--profile'), 'settings.json')
  const original = fs.readFileSync(settingsPath), saved = JSON.parse(original.toString('utf8'))
  const raw = saved.settings.serviceProviders.profiles.find(profile => profile.presetId === 'asr-aliyun_qwen' && profile.service === 'transcription')
  if (!raw) throw new Error('No saved Alibaba Cloud transcription provider')
  const provider = api.providerProfileSchema.parse(raw)
  const encrypted = saved.encryptedProviderCredentials?.[provider.id]
  if (encrypted) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Credential encryption unavailable')
    const credentials = JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64')))
    if (typeof credentials.apiKey !== 'string') throw new Error('Invalid saved credentials')
    provider.apiKey = credentials.apiKey
  }
  if (!provider.apiKey) throw new Error('No readable Alibaba Cloud API key; no request sent')
  const recordings = []
  for (const fixture of cases) {
    const audioPath = path.join(output, fixture.id + '.wav')
    execFileSync('/usr/bin/say', ['-v', 'Tingting', '-r', '170', '--file-format=WAVE', '--data-format=LEI16@16000', '-o', audioPath, fixture.text])
    const audio = fs.readFileSync(audioPath)
    assert.equal(audio.toString('ascii', 0, 4), 'RIFF'); assert.equal(audio.toString('ascii', 8, 12), 'WAVE')
    let pcm, validFormat = false
    for (let offset = 12; offset + 8 <= audio.length;) {
      const tag = audio.toString('ascii', offset, offset + 4), size = audio.readUInt32LE(offset + 4), start = offset + 8
      assert(start + size <= audio.length)
      if (tag === 'fmt ') {
        assert(size >= 16)
        assert.equal(audio.readUInt16LE(start), 1); assert.equal(audio.readUInt16LE(start + 2), 1)
        assert.equal(audio.readUInt32LE(start + 4), 16000); assert.equal(audio.readUInt16LE(start + 14), 16)
        validFormat = true
      }
      if (tag === 'data') {
        assert.equal(size % 2, 0)
        pcm = Float32Array.from({ length: size / 2 }, (_, index) => audio.readInt16LE(start + index * 2) / 32768)
      }
      offset = start + size + size % 2
    }
    assert(validFormat && pcm?.length, 'Expected mono PCM16 16kHz synthetic speech')
    recordings.push({ ...fixture, pcm, sampleRate: 16000, audioPath, audioSha256: createHash('sha256').update(audio).digest('hex') })
  }
  const variants = [
    { model: 'qwen-audio-3.1-asr-flash-message', providerPolish: false, label: 'message-raw' },
    { model: 'qwen-audio-3.1-asr-flash-message', providerPolish: true, label: 'message-native-cleanup' },
    { model: 'qwen-audio-3.1-asr-flash-streaming', providerPolish: false, label: 'streaming' }
  ]
  const report = { startedAt: new Date().toISOString(), syntheticOnly: true, voice: 'macOS Tingting, 170 words/min',
    noSeparateWritingModel: true, providerId: provider.id, rows: [] }
  const save = () => fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
  save()
  const jobs = recordings.flatMap(recording => variants.map(variant => ({ recording, variant })))
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const { recording, variant } = jobs[next++]
      const row = { id: recording.id, text: recording.text, audioPath: recording.audioPath, audioSha256: recording.audioSha256,
        variant: variant.label, model: variant.model, providerPolish: variant.providerPolish,
        durationMs: recording.pcm.length / recording.sampleRate * 1000, partials: [] }
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), row.durationMs + 60_000)
      const started = Date.now()
      try {
        const session = api.startLiveTranscription(provider, variant.model, { durationMs: row.durationMs, sampleRate: 16000,
          language: 'zh', mode: 'voice_transcript', providerPolish: variant.providerPolish, signal: controller.signal }, text => {
          row.firstPartialMs ??= Date.now() - started
          row.partials.push({ atMs: Date.now() - started, text })
        }, () => { row.connectionReadyMs = Date.now() - started })
        // Capture early failures while continuing to respect the same cancellation path.
        let failure
        void session.result.catch(error => { failure = error; controller.abort() })
        for (let offset = 0; offset < recording.pcm.length; offset += 3200) {
          if (failure) throw failure
          controller.signal.throwIfAborted()
          session.pushPcm(recording.pcm.subarray(offset, offset + 3200))
          await new Promise(resolve => setTimeout(resolve, 200))
        }
        row.stoppedAtMs = Date.now() - started
        const result = await session.finish()
        row.output = result.text
        row.reportedProviderPolish = result.providerPolish
        row.totalMs = Date.now() - started
      } catch (error) {
        row.error = (error instanceof Error ? error.message : 'Request failed').split(provider.apiKey).join('<REDACTED>')
      } finally { clearTimeout(timer); controller.abort() }
      report.rows.push(row); save()
      console.log(`${report.rows.length}/${jobs.length} ${row.id} ${row.variant}: ${row.error ? 'failed: ' + row.error : 'completed'}`)
    }
  }
  await Promise.all([worker(), worker()])
  report.completedAt = new Date().toISOString(); save()
  if (!fs.readFileSync(settingsPath).equals(original)) throw new Error('Settings changed during evaluation; outputs preserved, no settings overwritten')
  const errors = report.rows.filter(row => row.error).length
  console.log(`Saved ${report.rows.length} attempts, ${errors} errors: ${output}/results.json`)
  app.exit(errors ? 1 : 0)
}).catch(error => { console.error(error instanceof Error ? error.message : 'Evaluation failed'); app.exit(1) })
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }))
