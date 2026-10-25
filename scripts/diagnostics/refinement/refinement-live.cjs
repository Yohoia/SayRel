// Explicit live evaluation: synthetic text only, saved credentials remain in memory.
const { app, safeStorage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { buildSync } = require('esbuild')
const root = path.resolve(__dirname, '../../..')
const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
if (!args.includes('--live') || !option('--profile') || !option('--label')) {
  console.error('Usage: electron refinement-live.cjs --live --profile <existing user-data directory> --label <unique run name> [--levels raw,light,strong] [--cases id,id]')
  app.exit(1)
} else {
  const label = option('--label')
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(label)) throw new Error('Invalid run label')
  const output = path.join(root, '.build/refinement-evaluation', label)
  if (fs.existsSync(output)) throw new Error('Run label already exists; preserve previous evidence')
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sayrel-live-evaluation-'))
  app.setName('Sayrel')
  app.setPath('userData', profile)
  app.commandLine.appendSwitch('disable-background-networking')
  app.whenReady().then(async () => {
    fs.mkdirSync(output, { recursive: true })
    const runtime = path.join(output, 'runtime.cjs')
    const promptPath = path.resolve(option('--prompt-file') ?? path.join(root, 'src/main/services/providers/refinementPrompt.ts'))
    const promptSource = fs.readFileSync(promptPath, 'utf8')
    buildSync({ stdin: { resolveDir: path.join(root, 'src/main/services/providers'), loader: 'ts', contents: `
      ${promptSource}
      export { completeChat } from ${JSON.stringify(path.join(root, 'src/main/services/providers/chat.ts'))};
      export { refinementQualityFixtures, gradeRefinementQuality } from ${JSON.stringify(path.join(root, 'scripts/diagnostics/refinement/refinement-quality-fixtures.ts'))};
      export { serviceProvidersSchema, providerSelectionSchema, selectedProvider } from ${JSON.stringify(path.join(root, 'src/shared/providers.ts'))};
    ` }, bundle: true, platform: 'node', format: 'cjs', outfile: runtime, logLevel: 'silent' })
    const api = require(runtime)
    const settingsPath = path.resolve(option('--profile'), 'settings.json')
    const originalSettings = fs.readFileSync(settingsPath)
    const saved = JSON.parse(originalSettings.toString('utf8'))
    const state = api.serviceProvidersSchema.parse({ ...saved.settings.serviceProviders, transcription: null, refinement: null })
    const selected = api.providerSelectionSchema.parse(saved.settings.serviceProviders.refinement)
    const selectedProfile = state.profiles.find(profile => profile.id === selected.providerId && profile.service === 'refinement')
    if (!selectedProfile) throw new Error('No default writing model selected')
    const encrypted = saved.encryptedProviderCredentials?.[selectedProfile.id]
    if (encrypted) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('System credential encryption unavailable')
      const credentials = JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64')))
      if (typeof credentials.apiKey !== 'string' || typeof credentials.accessToken !== 'string') throw new Error('Invalid saved credentials')
      selectedProfile.apiKey = credentials.apiKey
      selectedProfile.accessToken = credentials.accessToken
    }
    const selection = api.selectedProvider(api.serviceProvidersSchema.parse({ ...state, refinement: selected }), 'refinement')
    if (!selection) throw new Error('No readable writing model selected')
    if (!selection.profile.apiKey && !['ollama'].includes(selection.profile.protocol)) throw new Error('Selected model has no readable credentials; no request sent')
    const levels = (option('--levels') ?? 'raw,light,strong').split(',')
    if (!levels.every(level => ['raw', 'light', 'strong'].includes(level))) throw new Error('Invalid cleanup level')
    const caseIds = option('--cases')?.split(',')
    const fixtures = api.refinementQualityFixtures.filter(fixture => !caseIds || caseIds.includes(fixture.id))
    if (!fixtures.length || caseIds && fixtures.length !== caseIds.length) throw new Error('Unknown case ID')
    const rows = []
    const report = { startedAt: new Date().toISOString(), model: selection.model, providerId: selection.profile.id,
      protocol: selection.profile.protocol, thinkingMode: selection.profile.thinkingMode ?? 'auto', promptVersion: api.REFINEMENT_PROMPT_VERSION,
      syntheticOnly: true, grading: 'Strong: minimum pattern contract only. All writing quality still needs output review.', rows }
    const save = () => fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
    fs.writeFileSync(path.join(output, 'prompt-source.ts'), promptSource)
    save()
    // Limit concurrency and request count; do not retry or expand to another provider silently.
    const jobs = fixtures.flatMap(fixture => levels.map(level => ({ fixture, level })))
    let next = 0
    const worker = async () => {
      while (next < jobs.length) {
        const { fixture, level } = jobs[next++]
        const request = { ...fixture.request, polishLevel: level, writingStyle: 'neutral', autoPunctuation: true }
        const system = api.buildRefinementSystemPrompt(request), user = api.buildRefinementUserPrompt(request)
        const row = { id: fixture.id, level, transcript: request.transcript, expectedExample: fixture.example,
          review: fixture.review, promptHash: createHash('sha256').update(system).digest('hex'), startedAt: new Date().toISOString() }
        const started = Date.now()
        try {
          const text = await api.completeChat(selection.profile, selection.model, [{ role: 'system', content: system }, { role: 'user', content: user }], undefined, 'dictation')
          Object.assign(row, { output: text, changed: text !== request.transcript,
            minimumContract: level === 'strong' ? api.gradeRefinementQuality(fixture, text) : 'not-automatically-graded' })
        } catch (error) {
          // Transport messages are sanitized; never serialize request objects, headers or credentials.
          Object.assign(row, { error: error instanceof Error ? error.message : 'Provider request failed' })
        }
        Object.assign(row, { durationMs: Date.now() - started })
        rows.push(row); save()
        console.log(`${rows.length}/${jobs.length} ${fixture.id} ${level}: ${row.error ? 'request-failed' : row.minimumContract?.status ?? 'review-required'}`)
      }
    }
    await Promise.all([worker(), worker()])
    report.completedAt = new Date().toISOString()
    save()
    if (!fs.readFileSync(settingsPath).equals(originalSettings)) throw new Error('Settings changed during evaluation; inspect before comparing runs')
    const errors = rows.filter(row => row.error).length
    console.log(`Saved synthetic outputs: ${output}/results.json; ${rows.length} requests, ${errors} errors`)
    app.exit(errors ? 1 : 0)
  }).catch(error => {
    console.error(error instanceof Error ? error.message : 'Evaluation failed')
    app.exit(1)
  })
  app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }))
}
