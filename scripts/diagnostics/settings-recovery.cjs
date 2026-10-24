// Executes the real settings module with an in-memory Store and simulated OS encryption.
// Never opens Electron, a user profile, or the system keychain.
const assert = require('node:assert/strict')
const { build } = require('esbuild')
const { resolve } = require('node:path')
let checks = 0
const equal = (...args) => { checks++; assert.equal(...args) }
const deepEqual = (...args) => { checks++; assert.deepEqual(...args) }
const throws = (...args) => { checks++; assert.throws(...args) }
const secret = (apiKey, accessToken = '') => ({ apiKey, accessToken })
const cipher = value => Buffer.from(`test-encrypted:${value}`).toString('base64')
const encode = value => cipher(JSON.stringify(value))
const profile = (id, service = 'transcription') => ({
  id, presetId: service === 'transcription' ? 'asr-openai' : 'llm-openai_compatible', name: `Provider ${id}`, enabled: true,
  service, protocol: service === 'transcription' ? 'openai-transcription' : 'openai-chat', endpoint: 'https://example.test/v1',
  apiKey: '', accessToken: '', models: [`model-${id}`], appId: '', resourceId: '', apiVersion: '2024-10-21'
})
const asr = profile('asr')
const llm = profile('llm', 'refinement')
const select = p => ({ providerId: p.id, model: p.models[0] })
const state = (profiles = [asr, llm]) => ({ profiles, transcription: profiles.includes(asr) ? select(asr) : null, refinement: profiles.includes(llm) ? select(llm) : null })
const stored = () => ({ settings: { language: 'zh-CN', soundVolume: 0.7, serviceProviders: state() }, deviceId: 'test-device', encryptedProviderSecrets: encode({ asr: secret('original-asr'), llm: secret('original-llm') }) })

async function main() {
  const result = await build({
    entryPoints: [resolve(__dirname, '../../src/main/lib/settings.ts')], bundle: true, platform: 'node', format: 'cjs', write: false,
    plugins: [{ name: 'settings-boundaries', setup(builder) {
      builder.onResolve({ filter: /^(electron|electron-store)$|\/appIdentity$|\/logger$/ }, args => ({ path: args.path, namespace: 'settings-mock' }))
      builder.onLoad({ filter: /.*/, namespace: 'settings-mock' }, args => ({ contents:
        args.path === 'electron' ? 'module.exports = { safeStorage: globalThis.__settingsHarness.safeStorage }' :
        args.path === 'electron-store' ? 'module.exports = globalThis.__settingsHarness.Store' :
        args.path.endsWith('/logger') ? 'module.exports = { createLogger: () => ({ warn: message => globalThis.__settingsHarness.warnings.push(message) }) }' : '', loader: 'js' }))
    } }]
  })
  const instantiate = new Function('module', 'exports', 'require', result.outputFiles[0].text)
  function load(fixture, options = {}) {
    const harness = {
      data: structuredClone(fixture), warnings: [], locked: options.locked ?? false, encryptionAvailable: options.encryptionAvailable ?? true,
      blocked: new Set(options.blocked ?? []), encryptions: 0
    }
    harness.Store = class {
      constructor(options) { harness.data = { ...structuredClone(options.defaults), ...harness.data } }
      get(key) { return harness.data[key] }
      set(key, value) { harness.data[key] = structuredClone(value) }
      get store() { return harness.data }
      set store(value) { harness.data = structuredClone(value) }
    }
    harness.safeStorage = {
      isEncryptionAvailable: () => harness.encryptionAvailable,
      decryptString(buffer) {
        const encoded = buffer.toString('base64')
        if (harness.locked || harness.blocked.has(encoded)) throw new Error('Simulated keychain unavailable')
        const text = buffer.toString()
        if (!text.startsWith('test-encrypted:')) throw new Error('Invalid test ciphertext')
        return text.slice('test-encrypted:'.length)
      },
      encryptString(value) {
        if (!harness.encryptionAvailable) throw new Error('Simulated unavailable encryption')
        harness.encryptions++
        return Buffer.from(`test-encrypted:${value}`)
      }
    }
    globalThis.__settingsHarness = harness
    const module = { exports: {} }
    instantiate(module, module.exports, require)
    return { settings: module.exports.settings, harness }
  }
  const restart = entry => load(entry.harness.data, { locked: entry.harness.locked, encryptionAvailable: entry.harness.encryptionAvailable, blocked: [...entry.harness.blocked] })
  const refill = (entry, id, apiKey, activate = true) => {
    const providers = entry.settings.get().serviceProviders
    const target = providers.profiles.find(p => p.id === id)
    return entry.settings.patch({ serviceProviders: { ...providers, profiles: providers.profiles.map(p => p.id === id ? { ...p, apiKey } : p), ...(activate ? { [target.service]: select(target) } : {}) } })
  }
  const remove = (entry, ids) => {
    const providers = entry.settings.get().serviceProviders
    return entry.settings.patch({ serviceProviders: { profiles: providers.profiles.filter(p => !ids.includes(p.id)), transcription: ids.includes(providers.transcription?.providerId) ? null : providers.transcription, refinement: ids.includes(providers.refinement?.providerId) ? null : providers.refinement } })
  }

  let entry = load(stored())
  equal(entry.settings.get().serviceProviders.profiles[0].apiKey, 'original-asr', 'healthy bundle hydrates keys')
  deepEqual(entry.settings.get().providerCredentialsUnavailable, [], 'healthy settings expose no recovery state')
  entry.settings.patch({ soundVolume: 0.4 })
  equal(entry.harness.data.encryptedProviderSecrets, undefined, 'healthy bundle migrates to profile envelopes')
  equal(Object.keys(entry.harness.data.encryptedProviderCredentials).length, 2, 'each profile receives independent encrypted storage')
  equal(entry.harness.data.settings.providerCredentialsUnavailable, undefined, 'recovery state is runtime-only')
  equal(JSON.stringify(entry.harness.data).includes('original-asr'), false, 'credentials never appear on disk as plaintext')
  entry = restart(entry)
  equal(entry.settings.get().serviceProviders.profiles[1].apiKey, 'original-llm', 'profile credentials survive restart')
  equal(entry.settings.get().soundVolume, 0.4, 'ordinary settings survive migration')
  equal(entry.settings.deviceId, 'test-device', 'device ID survives migration')

  entry = load(stored(), { locked: true, encryptionAvailable: false })
  const encrypted = entry.harness.data.encryptedProviderSecrets
  equal(entry.settings.get().serviceProviders.transcription, null, 'locked keychain clears runtime ASR default')
  equal(entry.settings.get().serviceProviders.refinement, null, 'locked keychain clears even key-optional custom defaults')
  deepEqual(entry.settings.get().providerCredentialsUnavailable, ['asr', 'llm'], 'both locked profiles are visibly recoverable')
  equal(entry.settings.get().serviceProviders.profiles[0].endpoint, asr.endpoint, 'non-secret provider metadata remains editable')
  entry.settings.patch({ language: 'ja' })
  equal(entry.harness.data.encryptedProviderSecrets, encrypted, 'unrelated save keeps unreadable ciphertext byte-for-byte')
  deepEqual(entry.harness.data.settings.serviceProviders.transcription, select(asr), 'unrelated save preserves encrypted-profile default on disk')
  entry = restart(entry)
  equal(entry.settings.get().language, 'ja', 'unrelated preference saves while keychain is locked')
  equal(entry.settings.get().serviceProviders.transcription, null, 'locked restart remains usable without selecting missing credentials')
  entry.harness.locked = false
  entry.harness.encryptionAvailable = true
  entry.settings.invalidateCache()
  equal(entry.settings.get().serviceProviders.profiles[0].apiKey, 'original-asr', 'unlock and reload recover original keys')
  deepEqual(entry.settings.get().serviceProviders.transcription, select(asr), 'unlock restores original default')
  deepEqual(entry.settings.get().providerCredentialsUnavailable, [], 'unlock clears recovery indicator')

  const corrupt = cipher('{invalid JSON')
  const broken = stored()
  broken.encryptedProviderSecrets = corrupt
  entry = load(broken)
  equal(entry.settings.get().serviceProviders.profiles.length, 2, 'malformed secret JSON cannot prevent startup')
  deepEqual(entry.settings.get().providerCredentialsUnavailable, ['asr', 'llm'], 'malformed JSON is recoverable instead of treated as empty')
  entry.settings.patch({ launchAtLogin: true })
  equal(entry.harness.data.encryptedProviderSecrets, corrupt, 'malformed encrypted content survives unrelated writes')
  refill(entry, 'asr', 'replacement-asr')
  equal(entry.harness.data.encryptedProviderSecrets, corrupt, 'refilling one provider preserves the other unknown key')
  deepEqual(entry.settings.get().providerCredentialsUnavailable, ['llm'], 'refilled provider immediately becomes available')
  entry = restart(entry)
  equal(entry.settings.get().serviceProviders.profiles[0].apiKey, 'replacement-asr', 'replacement key survives restart beside corrupt legacy bundle')
  deepEqual(entry.settings.get().serviceProviders.transcription, select(asr), 'replacement default survives restart')
  deepEqual(entry.settings.get().providerCredentialsUnavailable, ['llm'], 'other profile retains recovery state after restart')
  refill(entry, 'llm', 'replacement-llm')
  equal(entry.harness.data.encryptedProviderSecrets, undefined, 'replacing all dependent profiles removes corrupt legacy bundle')
  entry = restart(entry)
  deepEqual(entry.settings.get().providerCredentialsUnavailable, [], 'all replacements survive clean restart')
  equal(entry.settings.get().serviceProviders.profiles[1].apiKey, 'replacement-llm', 'second replacement survives clean restart')

  entry = load(broken)
  remove(entry, ['asr'])
  equal(entry.harness.data.encryptedProviderSecrets, corrupt, 'deleting one unknown provider preserves others')
  equal(entry.harness.data.clearedProviderCredentials.includes('asr'), true, 'deleted provider cannot inherit credentials from retained bundle')
  remove(entry, ['llm'])
  equal(entry.harness.data.encryptedProviderSecrets, undefined, 'deleting all providers deletes unknown bundle')
  equal(entry.harness.data.encryptedProviderCredentials, undefined, 'deleting all providers deletes profile ciphertexts')
  entry = restart(entry)
  equal(entry.settings.get().serviceProviders.profiles.length, 0, 'deleted providers do not reappear on restart')

  const legacy = { transcription: 'openai-compatible', refinement: 'openai-compatible', baseUrl: 'https://example.test/v1', apiKey: null, model: 'old-asr', refinementModel: 'old-llm' }
  entry = load({ settings: { provider: legacy }, encryptedApiKey: cipher('legacy-key') })
  equal(entry.settings.get().provider.apiKey, null, 'legacy credential is no longer duplicated in runtime provider settings')
  equal(entry.settings.get().serviceProviders.profiles[0].apiKey, 'legacy-key', 'legacy key migrates to transcription')
  equal(entry.settings.get().serviceProviders.profiles[1].apiKey, 'legacy-key', 'legacy key migrates to refinement')
  entry.settings.patch({ historyEnabled: false })
  equal(entry.harness.data.encryptedApiKey, undefined, 'saving migrated profile removes legacy encrypted key')
  equal(entry.harness.data.encryptedProviderSecrets, undefined, 'migration never recreates __legacy bundle')
  entry = restart(entry)
  equal(entry.settings.get().serviceProviders.profiles[0].apiKey, 'legacy-key', 'migrated per-profile key survives restart')
  remove(entry, ['migrated-transcription', 'migrated-refinement'])
  equal(entry.harness.data.encryptedProviderCredentials, undefined, 'deleting migrated providers removes every migrated credential')
  equal(entry.harness.data.settings.provider.apiKey, null, 'deleting migrated provider cannot leave legacy plaintext behind')
  equal(restart(entry).settings.get().serviceProviders.profiles.length, 0, 'legacy settings do not resurrect deleted profiles')

  entry = load({ settings: { provider: legacy }, encryptedApiKey: cipher('legacy-key') }, { locked: true, encryptionAvailable: false })
  entry.settings.patch({ soundVolume: 0.3 })
  equal(entry.harness.data.encryptedApiKey, cipher('legacy-key'), 'locked legacy key survives an unrelated write')
  entry.harness.locked = false
  entry.harness.encryptionAvailable = true
  entry = restart(entry)
  equal(entry.settings.get().serviceProviders.profiles[0].apiKey, 'legacy-key', 'locked legacy migration recovers after unlock')
  equal(entry.settings.get().serviceProviders.transcription.providerId, 'migrated-transcription', 'legacy default survives locked migration')
  entry = load({ settings: { provider: legacy }, encryptedApiKey: cipher('legacy-key') }, { encryptionAvailable: false })
  entry.settings.patch({ soundVolume: 0.2 })
  equal(restart(entry).settings.get().serviceProviders.profiles[1].apiKey, 'legacy-key', 'readable legacy key is retained when encryption becomes unavailable')

  entry = load(stored())
  entry.settings.patch({ soundVolume: 0.2 })
  entry.harness.encryptionAvailable = false
  const healthyCiphertexts = structuredClone(entry.harness.data.encryptedProviderCredentials)
  entry.settings.patch({ language: 'en' })
  deepEqual(entry.harness.data.encryptedProviderCredentials, healthyCiphertexts, 'unrelated writes reuse healthy ciphertext without OS encryption')
  const before = structuredClone(entry.harness.data)
  throws(() => refill(entry, 'asr', 'cannot-save'), /Unlock your keychain/, 'new credentials fail clearly without available encryption')
  deepEqual(entry.harness.data, before, 'failed credential replacement is atomic')
  equal(entry.settings.get().serviceProviders.profiles[0].apiKey, 'original-asr', 'failed credential replacement retains runtime key')
  entry.harness.locked = true
  entry.settings.invalidateCache()
  entry.settings.reset()
  equal(entry.harness.data.encryptedProviderCredentials, undefined, 'explicit reset deletes even locked ciphertext')
  equal(entry.settings.get().serviceProviders.profiles.length, 0, 'explicit reset returns default unconfigured state')

  const perProfile = stored()
  delete perProfile.encryptedProviderSecrets
  perProfile.encryptedProviderCredentials = { asr: cipher('not JSON'), llm: encode(secret('good-llm')) }
  entry = load(perProfile)
  deepEqual(entry.settings.get().providerCredentialsUnavailable, ['asr'], 'one corrupt profile cannot hide healthy credentials')
  equal(entry.settings.get().serviceProviders.profiles[1].apiKey, 'good-llm', 'healthy independent profile loads beside a corrupt one')
  entry.settings.patch({ soundVolume: 0.1 })
  equal(entry.harness.data.encryptedProviderCredentials.asr, perProfile.encryptedProviderCredentials.asr, 'unreadable profile ciphertext survives unrelated save')
  refill(entry, 'asr', 'recovered-asr')
  entry = restart(entry)
  deepEqual(entry.settings.get().providerCredentialsUnavailable, [], 'replacing corrupt profile clears recovery after restart')
  equal(entry.settings.get().serviceProviders.profiles[0].apiKey, 'recovered-asr', 'replacement of independent corrupt credential persists')

  const bothUnreadable = stored()
  bothUnreadable.encryptedApiKey = cipher('unreadable-legacy')
  entry = load(bothUnreadable, { blocked: [bothUnreadable.encryptedProviderSecrets, bothUnreadable.encryptedApiKey] })
  entry.settings.patch({ soundVolume: 0.8 })
  equal(entry.harness.data.encryptedProviderSecrets, bothUnreadable.encryptedProviderSecrets, 'unrelated save retains an unreadable bundle beside another recovery source')
  equal(entry.harness.data.encryptedApiKey, bothUnreadable.encryptedApiKey, 'unrelated save never drops an unreadable secondary legacy source')
  refill(entry, 'asr', 'first-recovered')
  equal(entry.harness.data.encryptedApiKey, bothUnreadable.encryptedApiKey, 'partial recovery retains other potentially recoverable sources')
  refill(entry, 'llm', 'second-recovered')
  equal(entry.harness.data.encryptedApiKey, undefined, 'full explicit replacement removes all obsolete encrypted legacy sources')

  const badShape = stored()
  badShape.encryptedProviderSecrets = encode({ asr: { apiKey: 42, accessToken: '' } })
  entry = load(badShape)
  deepEqual(entry.settings.get().providerCredentialsUnavailable, ['asr', 'llm'], 'invalid secret schema cannot block startup')
  entry.settings.patch({ historyEnabled: false })
  equal(entry.harness.data.encryptedProviderSecrets, badShape.encryptedProviderSecrets, 'invalid-schema ciphertext is retained until explicit recovery')

  const tokenProfile = { ...asr, id: 'token', presetId: 'asr-volcengine', protocol: 'volcengine-asr', appId: 'test-app' }
  entry = load({ settings: { serviceProviders: { profiles: [tokenProfile], transcription: select(tokenProfile), refinement: null } }, encryptedProviderSecrets: encode({ token: secret('', 'saved-token') }) })
  equal(entry.settings.get().serviceProviders.profiles[0].accessToken, 'saved-token', 'token-based providers recover access tokens')
  entry.settings.patch({ soundVolume: 0.6 })
  entry = restart(entry)
  equal(entry.settings.get().serviceProviders.profiles[0].accessToken, 'saved-token', 'access tokens survive per-profile migration and restart')
  equal(JSON.stringify(entry.harness.data).includes('saved-token'), false, 'access tokens are never persisted in plaintext')

  const specialId = { ...asr, id: '__proto__' }
  entry = load({ settings: { serviceProviders: { profiles: [specialId], transcription: select(specialId), refinement: null } }, encryptedProviderCredentials: Object.fromEntries([['__proto__', encode(secret('prototype-key'))]]) })
  equal(entry.settings.get().serviceProviders.profiles[0].apiKey, 'prototype-key', 'provider IDs are handled as own keys, including prototype names')
  entry.settings.patch({ soundVolume: 0.5 })
  entry = restart(entry)
  equal(entry.settings.get().serviceProviders.profiles[0].apiKey, 'prototype-key', 'special provider IDs survive encrypted save and restart')

  const local = { ...asr, id: 'local', presetId: 'asr-local-whisper', protocol: 'local-whisper', endpoint: 'whisper-cli', models: ['/models/whisper.bin'] }
  const localProviders = { profiles: [local, llm], transcription: select(local), refinement: select(llm) }
  entry = load({ settings: { serviceProviders: localProviders }, encryptedProviderSecrets: corrupt })
  deepEqual(entry.settings.get().serviceProviders.transcription, select(local), 'corrupt cloud credential bundle cannot disable Local Whisper')
  deepEqual(entry.settings.get().providerCredentialsUnavailable, ['llm'], 'local transcription never acquires a cloud credential recovery warning')
  equal(entry.settings.get().serviceProviders.refinement, null, 'cloud refinement remains protected beside local transcription')
  entry.settings.patch({ soundVolume: 0.9 })
  equal(entry.harness.data.encryptedProviderSecrets, corrupt, 'local operation does not destroy the recoverable cloud bundle')
  entry = restart(entry)
  deepEqual(entry.settings.get().serviceProviders.transcription, select(local), 'local default survives unrelated save and restart while cloud credentials are broken')
  refill(entry, 'llm', 'cloud-recovered')
  equal(entry.harness.data.encryptedProviderSecrets, undefined, 'recovering the cloud provider removes its obsolete bundle even with a local profile present')
  deepEqual(entry.settings.get().providerCredentialsUnavailable, [], 'cloud recovery leaves both local and cloud profiles ready')
  deepEqual(restart(entry).settings.get().serviceProviders.transcription, select(local), 'local selection remains valid after cloud credential recovery')

  const ollama = { ...llm, id: 'ollama', presetId: 'llm-ollama', protocol: 'ollama', endpoint: 'http://localhost:11434' }
  const ollamaProviders = { profiles: [asr, ollama], transcription: select(asr), refinement: select(ollama) }
  const asrOnlyBundle = encode({ asr: secret('cloud-secret') })
  entry = load({ settings: { serviceProviders: ollamaProviders }, encryptedProviderSecrets: asrOnlyBundle }, { encryptionAvailable: false })
  deepEqual(entry.settings.get().serviceProviders.refinement, select(ollama), 'confirmed keyless Ollama is ready beside an encrypted cloud provider')
  entry.settings.patch({ soundVolume: 0.8 })
  equal(entry.harness.data.clearedProviderCredentials.includes('ollama'), true, 'known keyless configuration is recorded while an old encrypted bundle remains')
  entry.harness.blocked.add(asrOnlyBundle)
  entry = restart(entry)
  deepEqual(entry.settings.get().serviceProviders.refinement, select(ollama), 'known keyless Ollama remains ready when the unrelated cloud bundle later becomes unreadable')
  deepEqual(entry.settings.get().providerCredentialsUnavailable, ['asr'], "confirmed keyless profiles never inherit another provider's recovery state")
  entry = load({ settings: { serviceProviders: ollamaProviders }, encryptedProviderSecrets: corrupt })
  equal(entry.settings.get().serviceProviders.refinement, null, 'Ollama with unknown legacy credential membership is not silently treated as unauthenticated')
  deepEqual(entry.settings.get().providerCredentialsUnavailable, ['asr', 'ollama'], 'potential Ollama Bearer credentials retain recovery protection')

  delete globalThis.__settingsHarness
  console.log(`PASS settings recovery: ${checks} assertions covering encrypted migration, startup recovery, unrelated saves, replacement, restart, deletion and reset (mock Store/keychain only)`)
}
main().catch(error => { delete globalThis.__settingsHarness; console.error(error); process.exitCode = 1 })
