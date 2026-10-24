import assert from 'node:assert/strict'
import { mergeSettings, DEFAULT_SETTINGS } from '../../../src/shared/settings'
import { createProviderProfile, PROVIDER_PRESETS } from '../../../src/shared/providerPresets'
import { EMPTY_SERVICE_PROVIDERS, providerActionSchema, providerProfileSchema, serviceProvidersSchema, supportsDeepSeekThinking, updateProviderState } from '../../../src/shared/providers'

assert.equal(new Set(PROVIDER_PRESETS.map(p => p.id)).size, PROVIDER_PRESETS.length)
for (const preset of PROVIDER_PRESETS) {
  const draft = createProviderProfile(preset)
  assert.equal(draft.enabled, false, `${preset.id} must start disabled`)
  const parsed = providerProfileSchema.safeParse({ ...draft, endpoint: draft.endpoint || 'https://example.test/v1' })
  assert.ok(parsed.success, preset.id)
}
const preset = PROVIDER_PRESETS.find(p => p.id === 'llm-deepseek')
assert.ok(preset)
const disabledProfile = { ...createProviderProfile(preset), apiKey: 'fake-key' }
assert(disabledProfile.service === 'refinement')
const disabledState = updateProviderState(EMPTY_SERVICE_PROVIDERS, { action: 'save', profile: disabledProfile })
assert.equal(disabledState.profiles[0].enabled, false)
assert.equal(disabledState.refinement, null)
const profile = { ...disabledProfile, enabled: true }
const defaultThinking = providerProfileSchema.parse({ ...profile, thinkingMode: undefined })
assert(defaultThinking.service === 'refinement')
assert.equal(defaultThinking.thinkingMode, 'auto')
assert.equal(providerActionSchema.safeParse({ action: 'save', profile: { ...profile, thinkingMode: 'sometimes' } }).success, false)
for (const thinkingMode of ['auto', 'enabled', 'disabled'] as const) {
  const saved = updateProviderState(EMPTY_SERVICE_PROVIDERS, { action: 'save', profile: { ...profile, thinkingMode } })
  const persisted = mergeSettings({ serviceProviders: JSON.parse(JSON.stringify(saved)) })
  assert.equal(persisted.serviceProviders.profiles.find(profile => profile.service === 'refinement')?.thinkingMode, thinkingMode)
}
assert(supportsDeepSeekThinking(profile, 'deepseek-flash'))
assert(supportsDeepSeekThinking(profile, 'deepseek-v4-pro'))
for (const endpoint of ['http://api.deepseek.com', 'https://api.deepseek.com.evil.test', 'https://proxy.example/api.deepseek.com', 'https://api.deepseek.com:8443', 'https://user@api.deepseek.com']) assert(!supportsDeepSeekThinking({ ...profile, endpoint }, 'deepseek-flash'))
assert(!supportsDeepSeekThinking(profile, 'deepseek-chat'))
assert(!supportsDeepSeekThinking({ ...profile, protocol: 'openai-responses' }, 'deepseek-flash'))
console.log('PASS thinking settings: legacy auto default, three modes persist, invalid modes rejected, official supported target isolation')
let state = updateProviderState(EMPTY_SERVICE_PROVIDERS, { action: 'save', profile, activateModel: profile.models[0] })
assert.equal(state.refinement?.providerId, profile.id)
assert.throws(() => updateProviderState(state, { action: 'select', service: 'transcription', selection: state.refinement }))
assert.throws(() => updateProviderState(state, { action: 'save', profile: { ...profile, models: [] } }))
assert.throws(() => updateProviderState(state, { action: 'select', service: 'refinement', selection: { providerId: profile.id, model: 'missing' } }))
assert.equal(providerActionSchema.safeParse({ action: 'save', profile: { ...profile, protocol: 'qwen-asr' } }).success, false)
assert.equal(providerActionSchema.safeParse({ action: 'test', profile: { ...profile, endpoint: 'file:///etc/hosts' }, model: 'model' }).success, false)
assert.equal(providerActionSchema.safeParse({ action: 'test', profile: { ...profile, endpoint: 'https://user:secret@example.test' }, model: 'model' }).success, false)
assert.equal(serviceProvidersSchema.safeParse({ ...state, profiles: [profile, profile] }).success, false)
state = updateProviderState(state, { action: 'save', profile: { ...profile, enabled: false } })
assert.equal(state.refinement, null)
state = updateProviderState(state, { action: 'save', profile, activateModel: profile.models[0] })
state = updateProviderState(state, { action: 'save', profile: { ...profile, models: ['new-model'] } })
assert.equal(state.refinement, null)
state = updateProviderState(state, { action: 'remove', id: profile.id })
assert.deepEqual(state, EMPTY_SERVICE_PROVIDERS)
console.log(`PASS service configuration: ${PROVIDER_PRESETS.length} presets, role isolation, URL/protocol validation, removal/disable/default integrity`)

const preferredModel = profile.models[profile.models.length - 1]
const incompleteProfile = { ...profile, apiKey: '', preferredModel }
const incompleteState = updateProviderState(EMPTY_SERVICE_PROVIDERS, { action: 'save', profile: incompleteProfile })
assert.equal(incompleteState.refinement, null)
assert.equal(incompleteState.profiles[0].preferredModel, preferredModel)
assert.equal(mergeSettings({ serviceProviders: incompleteState }).serviceProviders.profiles[0].preferredModel, preferredModel)
assert.equal(providerProfileSchema.safeParse({ ...incompleteProfile, preferredModel: 'missing-model' }).success, false)
assert.throws(() => updateProviderState(incompleteState, { action: 'select', service: 'refinement', selection: { providerId: profile.id, model: preferredModel } }))
console.log('PASS model preference saves without credentials; incomplete profiles cannot become active providers')

const oldEmpty = mergeSettings({ provider: { ...DEFAULT_SETTINGS.provider, apiKey: null } })
assert.equal(oldEmpty.serviceProviders.profiles.find(profile => profile.service === 'refinement')?.thinkingMode, 'auto')
assert.equal(oldEmpty.serviceProviders.transcription, null)
assert.equal(oldEmpty.serviceProviders.refinement, null)
const oldLocal = mergeSettings({ provider: { ...DEFAULT_SETTINGS.provider, transcription: 'local-whisper', model: '/usr/local/bin/whisper-cli', baseUrl: '/models/ggml.bin' , refinement: 'mock' } })
assert.equal(oldLocal.serviceProviders.profiles[0].endpoint, '/usr/local/bin/whisper-cli')
assert.deepEqual(oldLocal.serviceProviders.profiles[0].models, ['/models/ggml.bin'])
assert.ok(oldLocal.serviceProviders.transcription)
console.log('PASS old unconfigured and local Whisper settings migrate without invalid defaults')
const legacyCloud = mergeSettings({ provider: JSON.parse(JSON.stringify(DEFAULT_SETTINGS.provider).replaceAll('openai-compatible', 'offkey-cloud')) })
assert.equal(legacyCloud.provider.transcription, 'sayrel-cloud')
assert.equal(legacyCloud.provider.refinement, 'sayrel-cloud')
console.log('PASS persisted legacy cloud identifiers migrate to Sayrel')
