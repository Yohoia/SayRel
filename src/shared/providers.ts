import { z } from 'zod'

export const providerServiceSchema = z.enum(['transcription', 'refinement'])
export type ProviderService = z.infer<typeof providerServiceSchema>
export const transcriptionProtocols = ['openai-transcription', 'audio-chat', 'qwen-asr', 'volcengine-asr', 'soniox', 'elevenlabs', 'openai-realtime', 'stepfun-asr', 'mimo-asr', 'local-whisper'] as const
export const refinementProtocols = ['openai-chat', 'openai-responses', 'anthropic', 'gemini', 'ollama', 'azure-openai'] as const
export const providerProtocolSchema = z.enum([...transcriptionProtocols, ...refinementProtocols])
export type ProviderProtocol = z.infer<typeof providerProtocolSchema>
export const thinkingModeSchema = z.enum(['auto', 'enabled', 'disabled'])
export type ThinkingMode = z.infer<typeof thinkingModeSchema>
const common = {
  id: z.string().min(1).max(120),
  presetId: z.string().max(120),
  name: z.string().trim().min(1, "Enter a provider name").max(80),
  enabled: z.boolean(),
  endpoint: z.string().trim().max(2048),
  apiKey: z.string().trim().max(4096),
  models: z.array(z.string().trim().min(1).max(200)).max(200),
  preferredModel: z.string().trim().min(1).max(200).optional(),
  appId: z.string().trim().max(200),
  accessToken: z.string().trim().max(4096),
  resourceId: z.string().trim().max(200),
  apiVersion: z.string().trim().max(100)
}
export const providerProfileSchema = z.discriminatedUnion('service', [
  z.object({ ...common, service: z.literal('transcription'), protocol: z.enum(transcriptionProtocols) }),
  z.object({ ...common, service: z.literal('refinement'), protocol: z.enum(refinementProtocols), thinkingMode: thinkingModeSchema.default('auto') })
]).superRefine((profile, ctx) => {
  if (profile.preferredModel && !profile.models.includes(profile.preferredModel)) ctx.addIssue({ code: 'custom', path: ['preferredModel'], message: "Select a model for this provider" })
  if (profile.protocol === 'local-whisper') return
  try {
    const url = new URL(profile.endpoint)
    if (!['https:', 'http:', 'wss:', 'ws:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error()
    if (profile.service === 'refinement' && !['https:', 'http:'].includes(url.protocol)) throw new Error()
  } catch { ctx.addIssue({ code: 'custom', path: ['endpoint'], message: "Enter a valid API base URL" }) }
  if (new Set(profile.models).size !== profile.models.length) ctx.addIssue({ code: 'custom', path: ['models'], message: "Model IDs must be unique" })
})
export type ProviderProfile = z.infer<typeof providerProfileSchema>

export function supportsDeepSeekThinking(profile: Pick<ProviderProfile, 'service' | 'protocol' | 'endpoint'>, model: string): boolean {
  if (profile.service !== 'refinement' || profile.protocol !== 'openai-chat' || !['deepseek-flash', 'deepseek-v4-pro'].includes(model)) return false
  try {
    const url = new URL(profile.endpoint)
    return url.protocol === 'https:' && url.hostname === 'api.deepseek.com' && !url.port && !url.username && !url.password && !url.hash
  } catch { return false }
}
export const providerSelectionSchema = z.object({ providerId: z.string(), model: z.string() })
export type ProviderSelection = z.infer<typeof providerSelectionSchema>
export const serviceProvidersSchema = z.object({
  profiles: z.array(providerProfileSchema).max(100),
  transcription: providerSelectionSchema.nullable(),
  refinement: providerSelectionSchema.nullable()
}).superRefine((state, ctx) => {
  if (new Set(state.profiles.map(p => p.id)).size !== state.profiles.length) ctx.addIssue({ code: 'custom', path: ['profiles'], message: "Provider IDs must be unique" })
  for (const profile of state.profiles) if (!profile.models.length) ctx.addIssue({ code: 'custom', path: ['profiles'], message: "Add at least one model" })
  for (const service of ['transcription', 'refinement'] as const) {
    const selected = state[service]
    if (selected && !state.profiles.some(p => p.id === selected.providerId && p.service === service && p.enabled && p.models.includes(selected.model) && !providerConfigurationIssue(p))) ctx.addIssue({ code: 'custom', path: [service], message: "The default model must belong to an enabled provider" })
  }
})
export type ServiceProviders = z.infer<typeof serviceProvidersSchema>
export const EMPTY_SERVICE_PROVIDERS: ServiceProviders = { profiles: [], transcription: null, refinement: null }
export const providerActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), profile: providerProfileSchema, activateModel: z.string().optional() }),
  z.object({ action: z.literal('remove'), id: z.string() }),
  z.object({ action: z.literal('select'), service: providerServiceSchema, selection: providerSelectionSchema.nullable() }),
  z.object({ action: z.literal('test'), profile: providerProfileSchema, model: z.string().min(1) }),
  z.object({ action: z.literal('models'), profile: providerProfileSchema })
])
export type ProviderAction = z.infer<typeof providerActionSchema>
export const providerTestResultSchema = z.object({ ok: z.boolean(), message: z.string(), latencyMs: z.number().nonnegative() })
export type ProviderTestResult = z.infer<typeof providerTestResultSchema>
export const providerModelsSchema = z.array(z.string())

export function selectedProvider(state: ServiceProviders, service: ProviderService): { profile: ProviderProfile; model: string } | null {
  const choice = state[service]
  if (!choice) return null
  const profile = state.profiles.find(p => p.id === choice.providerId && p.service === service && p.enabled)
  if (!profile || !profile.models.includes(choice.model)) throw new Error("The default model is unavailable. Select another model in Providers.")
  return { profile, model: choice.model }
}

export function updateProviderState(state: ServiceProviders, action: Extract<ProviderAction, { action: 'save' | 'remove' | 'select' }>): ServiceProviders {
  if (action.action === 'select') return serviceProvidersSchema.parse({ ...state, [action.service]: action.selection })
  const profiles = state.profiles.filter(p => p.id !== (action.action === 'save' ? action.profile.id : action.id))
  if (action.action === 'save') profiles.push(action.profile)
  const next = { ...state, profiles }
  for (const service of ['transcription', 'refinement'] as const) {
    const choice = next[service]
    if (choice && !profiles.some(p => p.id === choice.providerId && p.enabled && p.models.includes(choice.model) && !providerConfigurationIssue(p))) next[service] = null
  }
  if (action.action === 'save' && action.activateModel) next[action.profile.service] = { providerId: action.profile.id, model: action.activateModel }
  return serviceProvidersSchema.parse(next)
}

export const protocolLabels: Record<ProviderProtocol, string> = {
  'openai-chat': "OpenAI compatible", 'openai-responses': 'OpenAI Responses', 'anthropic': 'Anthropic Messages', 'gemini': 'Gemini', 'ollama': 'Ollama', 'azure-openai': 'Azure OpenAI',
  'openai-transcription': "OpenAI audio transcription", 'audio-chat': "Audio Chat Completions", 'qwen-asr': "Alibaba Cloud realtime", 'volcengine-asr': "Volcengine transcription", 'soniox': "Soniox realtime", 'elevenlabs': 'ElevenLabs Scribe',
  'openai-realtime': 'OpenAI Realtime', 'stepfun-asr': 'StepAudio ASR', 'mimo-asr': 'MiMo ASR', 'local-whisper': "Local Whisper"
}

export function providerConfigurationIssue(profile: ProviderProfile, requireModel = true): string | null {
  if (!profile.enabled) return "Enable the provider first"
  if (!profile.endpoint.trim()) return "Enter an API base URL"
  if (requireModel && !profile.models.length) return "Add a model"
  if (profile.protocol === 'local-whisper' || profile.protocol === 'ollama') return null
  try {
    if (['localhost', '127.0.0.1', '[::1]'].includes(new URL(profile.endpoint).hostname)) return null
  } catch { return "Enter a valid API base URL" }
  if (profile.protocol === 'volcengine-asr' && profile.appId && profile.accessToken) return null
  if (profile.presetId.startsWith('custom') || profile.presetId === 'llm-openai_compatible' || profile.presetId === 'asr-audio-chat') return null
  if (!profile.apiKey) return "Enter an API key"
  return null
}
