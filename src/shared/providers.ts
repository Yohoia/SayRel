import { z } from 'zod'

export const providerServiceSchema = z.enum(['transcription', 'refinement'])
export type ProviderService = z.infer<typeof providerServiceSchema>
export const transcriptionProtocols = ['openai-transcription', 'audio-chat', 'qwen-asr', 'volcengine-asr', 'soniox', 'elevenlabs', 'openai-realtime', 'stepfun-asr', 'mimo-asr', 'local-whisper'] as const
export const refinementProtocols = ['openai-chat', 'openai-responses', 'anthropic', 'gemini', 'ollama', 'azure-openai'] as const
export const providerProtocolSchema = z.enum([...transcriptionProtocols, ...refinementProtocols])
export type ProviderProtocol = z.infer<typeof providerProtocolSchema>
const common = {
  id: z.string().min(1).max(120),
  presetId: z.string().max(120),
  name: z.string().trim().min(1, '请输入服务商名称').max(80),
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
  z.object({ ...common, service: z.literal('refinement'), protocol: z.enum(refinementProtocols) })
]).superRefine((profile, ctx) => {
  if (profile.preferredModel && !profile.models.includes(profile.preferredModel)) ctx.addIssue({ code: 'custom', path: ['preferredModel'], message: '请选择此服务商的模型' })
  if (profile.protocol === 'local-whisper') return
  try {
    const url = new URL(profile.endpoint)
    if (!['https:', 'http:', 'wss:', 'ws:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error()
    if (profile.service === 'refinement' && !['https:', 'http:'].includes(url.protocol)) throw new Error()
  } catch { ctx.addIssue({ code: 'custom', path: ['endpoint'], message: '请输入有效的服务地址' }) }
  if (new Set(profile.models).size !== profile.models.length) ctx.addIssue({ code: 'custom', path: ['models'], message: '模型 ID 不能重复' })
})
export type ProviderProfile = z.infer<typeof providerProfileSchema>
export const providerSelectionSchema = z.object({ providerId: z.string(), model: z.string() })
export type ProviderSelection = z.infer<typeof providerSelectionSchema>
export const serviceProvidersSchema = z.object({
  profiles: z.array(providerProfileSchema).max(100),
  transcription: providerSelectionSchema.nullable(),
  refinement: providerSelectionSchema.nullable()
}).superRefine((state, ctx) => {
  if (new Set(state.profiles.map(p => p.id)).size !== state.profiles.length) ctx.addIssue({ code: 'custom', path: ['profiles'], message: '服务商 ID 不能重复' })
  for (const profile of state.profiles) if (!profile.models.length) ctx.addIssue({ code: 'custom', path: ['profiles'], message: '请至少添加一个模型' })
  for (const service of ['transcription', 'refinement'] as const) {
    const selected = state[service]
    if (selected && !state.profiles.some(p => p.id === selected.providerId && p.service === service && p.enabled && p.models.includes(selected.model) && !providerConfigurationIssue(p))) ctx.addIssue({ code: 'custom', path: [service], message: '默认模型必须属于已启用的服务商' })
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
  if (!profile || !profile.models.includes(choice.model)) throw new Error('默认模型不可用，请在服务商页面重新选择')
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
  'openai-chat': 'OpenAI 兼容', 'openai-responses': 'OpenAI Responses', 'anthropic': 'Anthropic Messages', 'gemini': 'Gemini', 'ollama': 'Ollama', 'azure-openai': 'Azure OpenAI',
  'openai-transcription': 'OpenAI 音频转写', 'audio-chat': '音频 Chat Completions', 'qwen-asr': '阿里云实时语音', 'volcengine-asr': '火山引擎语音', 'soniox': 'Soniox 实时语音', 'elevenlabs': 'ElevenLabs Scribe',
  'openai-realtime': 'OpenAI Realtime', 'stepfun-asr': 'StepAudio ASR', 'mimo-asr': 'MiMo ASR', 'local-whisper': '本地 Whisper'
}

export function providerConfigurationIssue(profile: ProviderProfile, requireModel = true): string | null {
  if (!profile.enabled) return '请先启用服务商'
  if (!profile.endpoint.trim()) return '请填写服务地址'
  if (requireModel && !profile.models.length) return '请添加模型'
  if (profile.protocol === 'local-whisper' || profile.protocol === 'ollama') return null
  try {
    if (['localhost', '127.0.0.1', '[::1]'].includes(new URL(profile.endpoint).hostname)) return null
  } catch { return '请输入有效的服务地址' }
  if (profile.protocol === 'volcengine-asr' && profile.appId && profile.accessToken) return null
  if (profile.presetId.startsWith('custom') || profile.presetId === 'llm-openai_compatible' || profile.presetId === 'asr-audio-chat') return null
  if (!profile.apiKey) return '请填写 API Key'
  return null
}
