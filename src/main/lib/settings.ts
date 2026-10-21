import Store from 'electron-store'
import { safeStorage } from 'electron'
import { z } from 'zod'
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from '../../shared/settings'
import { serviceProvidersSchema } from '../../shared/providers'
import { createLogger } from './logger'

const log = createLogger('settings')
type Persisted = { settings: Settings; deviceId?: string; encryptedApiKey?: string; encryptedProviderSecrets?: string }
const store = new Store<Persisted>({ name: 'settings', defaults: { settings: DEFAULT_SETTINGS } })
const secretsSchema = z.record(z.string(), z.object({ apiKey: z.string(), accessToken: z.string() }))
let cache: Settings | null = null

function decrypt(encrypted: string | undefined): string | null {
  if (!encrypted) return null
  try { return safeStorage.decryptString(Buffer.from(encrypted, 'base64')) }
  catch { log.warn('Unable to decrypt saved provider credentials'); return null }
}

// The runtime snapshot retains credentials; every disk write uses a separate copy.
function persist(next: Settings): Settings {
  const secrets: z.infer<typeof secretsSchema> = {}
  for (const profile of next.serviceProviders.profiles) {
    if (profile.apiKey || profile.accessToken) secrets[profile.id] = { apiKey: profile.apiKey, accessToken: profile.accessToken }
  }
  if (next.provider.apiKey) secrets.__legacy = { apiKey: next.provider.apiKey, accessToken: '' }
  const hasSecrets = Object.keys(secrets).length > 0
  if (hasSecrets && !safeStorage.isEncryptionAvailable()) throw new Error('系统密钥加密不可用，服务商配置未保存，请解锁系统钥匙串后重试。')
  const encryptedProviderSecrets = hasSecrets ? safeStorage.encryptString(JSON.stringify(secrets)).toString('base64') : undefined
  const sanitized: Settings = {
    ...next,
    provider: { ...next.provider, apiKey: null },
    serviceProviders: { ...next.serviceProviders, profiles: next.serviceProviders.profiles.map(p => ({ ...p, apiKey: '', accessToken: '' })) }
  }
  const saved: Persisted = { settings: sanitized, deviceId: store.get('deviceId'), ...(encryptedProviderSecrets ? { encryptedProviderSecrets } : {}) }
  store.store = saved
  cache = next
  return next
}

function mergeNested<T extends object>(base: T, partial: Partial<T> | undefined): T { return { ...base, ...(partial ?? {}) } }

export const settings = {
  get(): Settings {
    if (cache) return cache
    const persisted = store.get('settings')
    const legacyKey = decrypt(store.get('encryptedApiKey'))
    const decodedSecrets = decrypt(store.get('encryptedProviderSecrets'))
    let secrets: z.infer<typeof secretsSchema> = {}
    if (decodedSecrets) {
      const parsed = secretsSchema.safeParse(JSON.parse(decodedSecrets))
      if (parsed.success) secrets = parsed.data
    }
    const legacy = { ...DEFAULT_SETTINGS.provider, ...persisted?.provider }
    legacy.apiKey = secrets.__legacy?.apiKey ?? legacyKey ?? legacy.apiKey
    const serviceProviders = persisted?.serviceProviders ? {
      ...persisted.serviceProviders,
      profiles: persisted.serviceProviders.profiles.map(profile => ({ ...profile, ...(secrets[profile.id] ?? {}) }))
    } : undefined
    cache = mergeSettings({ ...persisted, provider: legacy, ...(serviceProviders ? { serviceProviders } : {}) })
    return cache
  },
  invalidateCache(): void { cache = null },
  patch(partial: DeepPartial<Settings>): Settings {
    const current = settings.get()
    const next = mergeSettings({
      ...current, ...partial,
      shortcut: mergeNested(current.shortcut, partial.shortcut),
      commandShortcut: mergeNested(current.commandShortcut, partial.commandShortcut),
      askAnythingShortcut: mergeNested(current.askAnythingShortcut, partial.askAnythingShortcut),
      translationShortcut: mergeNested(current.translationShortcut, partial.translationShortcut),
      provider: mergeNested(current.provider, partial.provider),
      serviceProviders: partial.serviceProviders ? serviceProvidersSchema.parse({ ...current.serviceProviders, ...partial.serviceProviders }) : current.serviceProviders
    })
    return persist(next)
  },
  reset(): Settings { return persist(mergeSettings(structuredClone(DEFAULT_SETTINGS))) },
  get deviceId(): string {
    let id = store.get('deviceId')
    if (!id) { id = crypto.randomUUID(); store.set('deviceId', id) }
    return id
  }
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : string extends keyof T[K] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K]
}
