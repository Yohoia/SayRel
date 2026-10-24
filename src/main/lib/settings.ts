import './appIdentity'
import Store from 'electron-store'
import { safeStorage } from 'electron'
import { z } from 'zod'
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from '../../shared/settings'
import { providerConfigurationIssue, serviceProvidersSchema, type ServiceProviders } from '../../shared/providers'
import { createLogger } from './logger'

const log = createLogger('settings')
type PersistedSettings = Omit<Settings, 'providerCredentialsUnavailable'>
type Persisted = { settings: PersistedSettings; deviceId?: string; encryptedApiKey?: string; encryptedProviderSecrets?: string; encryptedProviderCredentials?: Record<string, string>; clearedProviderCredentials?: string[]; interfaceLanguageVersion?: number }
const store = new Store<Persisted>({ name: 'settings', defaults: { settings: DEFAULT_SETTINGS } })
const credentialSchema = z.object({ apiKey: z.string().max(4096), accessToken: z.string().max(4096) })
const secretsSchema = z.record(z.string(), credentialSchema)
type Credentials = z.infer<typeof credentialSchema>
type Decoded<T> = { kind: 'available'; value: T } | { kind: 'unavailable' }
type CredentialSource = 'profile' | 'bundle' | 'legacy' | 'empty'
type ProfileCredentials = { kind: 'available'; value: Credentials; source: CredentialSource } | { kind: 'unavailable'; source: Exclude<CredentialSource, 'empty'> }
type CredentialSnapshot = { persisted: Persisted; profiles: Map<string, ProfileCredentials>; selections: Pick<ServiceProviders, 'transcription' | 'refinement'>; unreadableBundle: boolean; unreadableLegacy: boolean }
let cache: Settings | null = null
let credentials: CredentialSnapshot | null = null
const emptyCredentials = (): Credentials => ({ apiKey: '', accessToken: '' })

function decrypt<T>(encrypted: string | undefined, parse: (value: string) => T): Decoded<T> | null {
  if (!encrypted) return null
  try { return { kind: 'available', value: parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64'))) } }
  catch { log.warn('Unable to read saved provider credentials; encrypted data is retained for recovery'); return { kind: 'unavailable' } }
}

function savedCredential(persisted: Persisted, id: string): string | undefined {
  const entries = persisted.encryptedProviderCredentials
  return entries && Object.hasOwn(entries, id) ? entries[id] : undefined
}

function restoreSelections(state: ServiceProviders, unavailable: ReadonlySet<string>): ServiceProviders {
  const next = { ...state }
  for (const service of ['transcription', 'refinement'] as const) {
    const selection = next[service]
    if (selection && !next.profiles.some(profile => profile.id === selection.providerId && profile.service === service && profile.models.includes(selection.model) && !unavailable.has(profile.id) && !providerConfigurationIssue(profile))) next[service] = null
  }
  return next
}

function encryptedCredential(value: Credentials): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('System credential encryption is unavailable. Unlock your keychain and try saving again.')
  return safeStorage.encryptString(JSON.stringify(value)).toString('base64')
}

// Preserve unreadable ciphertext until its profiles are explicitly replaced or removed.
function persist(next: Settings, providersEdited: boolean): Settings {
  const snapshot = credentials
  if (!snapshot) throw new Error('Load settings before saving them')
  const encryptedProviderCredentials = new Map<string, string>()
  const cleared = new Set(snapshot.persisted.clearedProviderCredentials ?? [])
  const nextProfiles = new Map<string, ProfileCredentials>()
  let keepBundle = false
  let keepLegacy = false
  for (const profile of next.serviceProviders.profiles) {
    const value = { apiKey: profile.apiKey, accessToken: profile.accessToken }
    const previous = snapshot.profiles.get(profile.id)
    const changed = previous?.kind === 'available'
      ? previous.value.apiKey !== value.apiKey || previous.value.accessToken !== value.accessToken
      : Boolean(value.apiKey || value.accessToken)
    const previousCiphertext = savedCredential(snapshot.persisted, profile.id)
    if (previous?.kind === 'unavailable' && !changed) {
      if (previous.source === 'profile' && previousCiphertext) encryptedProviderCredentials.set(profile.id, previousCiphertext)
      if (previous.source === 'bundle') keepBundle = true
      if (previous.source === 'legacy') keepLegacy = true
      nextProfiles.set(profile.id, previous)
      continue
    }
    if (value.apiKey || value.accessToken) {
      if (!changed && previous?.source === 'profile' && previousCiphertext) encryptedProviderCredentials.set(profile.id, previousCiphertext)
      else if (!changed && previous && !safeStorage.isEncryptionAvailable() && (previous.source === 'bundle' && snapshot.persisted.encryptedProviderSecrets || previous.source === 'legacy' && snapshot.persisted.encryptedApiKey)) {
        if (previous.source === 'bundle') keepBundle = true
        if (previous.source === 'legacy') keepLegacy = true
        nextProfiles.set(profile.id, { kind: 'available', value, source: previous.source })
        continue
      } else encryptedProviderCredentials.set(profile.id, encryptedCredential(value))
      cleared.delete(profile.id)
      nextProfiles.set(profile.id, { kind: 'available', value, source: 'profile' })
    } else {
      // Remember confirmed keyless profiles while another profile still needs an old envelope.
      cleared.add(profile.id)
      nextProfiles.set(profile.id, { kind: 'available', value, source: 'empty' })
    }
  }
  for (const id of snapshot.profiles.keys()) if (!nextProfiles.has(id)) cleared.add(id)
  // With no provider edit, even an orphaned/unknown legacy envelope remains recoverable.
  if (!providersEdited && !snapshot.profiles.size) {
    keepBundle = Boolean(snapshot.persisted.encryptedProviderSecrets)
    keepLegacy = Boolean(snapshot.persisted.encryptedApiKey)
  }
  const unavailable = new Set([...nextProfiles].filter(([, value]) => value.kind === 'unavailable').map(([id]) => id))
  keepBundle ||= snapshot.unreadableBundle && (unavailable.size > 0 || !providersEdited)
  keepLegacy ||= snapshot.unreadableLegacy && (unavailable.size > 0 || !providersEdited)
  const runtime = { ...next, provider: { ...next.provider, apiKey: null }, serviceProviders: restoreSelections(next.serviceProviders, unavailable), providerCredentialsUnavailable: [...unavailable] }
  const diskProviders = { ...runtime.serviceProviders }
  if (!providersEdited) {
    for (const service of ['transcription', 'refinement'] as const) {
      const selection = snapshot.selections[service]
      if (selection && unavailable.has(selection.providerId)) diskProviders[service] = selection
    }
  }
  const { providerCredentialsUnavailable: _unavailable, ...persistable } = runtime
  const sanitized: PersistedSettings = {
    ...persistable,
    serviceProviders: { ...diskProviders, profiles: diskProviders.profiles.map(profile => ({ ...profile, apiKey: '', accessToken: '' })) }
  }
  const saved: Persisted = {
    settings: sanitized, deviceId: snapshot.persisted.deviceId, interfaceLanguageVersion: 1,
    ...(encryptedProviderCredentials.size ? { encryptedProviderCredentials: Object.fromEntries(encryptedProviderCredentials) } : {}),
    ...(keepBundle && snapshot.persisted.encryptedProviderSecrets ? { encryptedProviderSecrets: snapshot.persisted.encryptedProviderSecrets } : {}),
    ...(keepLegacy && snapshot.persisted.encryptedApiKey ? { encryptedApiKey: snapshot.persisted.encryptedApiKey } : {}),
    ...((keepBundle || keepLegacy) && cleared.size ? { clearedProviderCredentials: [...cleared] } : {})
  }
  store.store = saved
  credentials = { persisted: saved, profiles: nextProfiles, selections: diskProviders, unreadableBundle: keepBundle && snapshot.unreadableBundle, unreadableLegacy: keepLegacy && snapshot.unreadableLegacy }
  cache = runtime
  return runtime
}

function mergeNested<T extends object>(base: T, partial: Partial<T> | undefined): T { return { ...base, ...(partial ?? {}) } }

export const settings = {
  get(): Settings {
    if (cache) return cache
    const persisted = store.store
    const legacyKey = decrypt(persisted.encryptedApiKey, value => z.string().max(4096).parse(value))
    const bundle = decrypt(persisted.encryptedProviderSecrets, value => secretsSchema.parse(JSON.parse(value)))
    const secrets = bundle?.kind === 'available' ? bundle.value : {}
    const legacy = { ...DEFAULT_SETTINGS.provider, ...persisted.settings?.provider }
    legacy.apiKey = secrets.__legacy?.apiKey ?? (legacyKey?.kind === 'available' ? legacyKey.value : legacy.apiKey)
    // Migrate metadata separately so missing credentials cannot invalidate saved defaults.
    const rawProviders = persisted.settings?.serviceProviders ?? mergeSettings({ provider: legacy }).serviceProviders
    if (!persisted.settings?.serviceProviders && (legacyKey?.kind === 'unavailable' || bundle?.kind === 'unavailable')) {
      for (const profile of rawProviders.profiles) rawProviders[profile.service] = { providerId: profile.id, model: profile.models[0] }
    }
    const cleared = new Set(persisted.clearedProviderCredentials ?? [])
    const unavailable = new Set<string>()
    const profiles = new Map<string, ProfileCredentials>()
    const hydrated = rawProviders.profiles.map(profile => {
      const own = profile.protocol === 'local-whisper' ? null : decrypt(savedCredential(persisted, profile.id), value => credentialSchema.parse(JSON.parse(value)))
      const migrated = profile.protocol !== 'local-whisper' && (profile.id === 'migrated-transcription' || profile.id === 'migrated-refinement')
      let result: ProfileCredentials
      // Local Whisper never uses credentials; HTTP providers may depend on optional Bearer keys.
      if (profile.protocol === 'local-whisper') result = { kind: 'available', value: emptyCredentials(), source: 'empty' }
      else if (own) result = own.kind === 'available' ? { ...own, source: 'profile' } : { kind: 'unavailable', source: 'profile' }
      else if (cleared.has(profile.id)) result = { kind: 'available', value: emptyCredentials(), source: 'empty' }
      else if (Object.hasOwn(secrets, profile.id)) result = { kind: 'available', value: secrets[profile.id], source: 'bundle' }
      else if (migrated && legacy.apiKey) result = { kind: 'available', value: { apiKey: legacy.apiKey, accessToken: '' }, source: secrets.__legacy ? 'bundle' : 'legacy' }
      else if (bundle?.kind === 'unavailable') result = { kind: 'unavailable', source: 'bundle' }
      else if (migrated && legacyKey?.kind === 'unavailable') result = { kind: 'unavailable', source: 'legacy' }
      else result = { kind: 'available', value: { apiKey: profile.apiKey, accessToken: profile.accessToken }, source: 'empty' }
      profiles.set(profile.id, result)
      if (result.kind === 'unavailable') unavailable.add(profile.id)
      return { ...profile, ...(result.kind === 'available' ? result.value : emptyCredentials()) }
    })
    credentials = { persisted, profiles, selections: rawProviders, unreadableBundle: bundle?.kind === 'unavailable', unreadableLegacy: legacyKey?.kind === 'unavailable' }
    cache = mergeSettings({ ...persisted.settings, provider: legacy, serviceProviders: restoreSelections({ ...rawProviders, profiles: hydrated }, unavailable), providerCredentialsUnavailable: [...unavailable] })
    return cache
  },
  invalidateCache(): void { cache = null; credentials = null },
  patch(partial: DeepPartial<Settings>): Settings {
    const current = settings.get()
    const next = mergeSettings({
      ...current, ...partial, providerCredentialsUnavailable: current.providerCredentialsUnavailable,
      shortcut: mergeNested(current.shortcut, partial.shortcut),
      commandShortcut: mergeNested(current.commandShortcut, partial.commandShortcut),
      askAnythingShortcut: mergeNested(current.askAnythingShortcut, partial.askAnythingShortcut),
      translationShortcut: mergeNested(current.translationShortcut, partial.translationShortcut),
      provider: mergeNested(current.provider, partial.provider),
      serviceProviders: partial.serviceProviders ? serviceProvidersSchema.parse({ ...current.serviceProviders, ...partial.serviceProviders }) : current.serviceProviders
    })
    return persist(next, Boolean(partial.serviceProviders))
  },
  reset(): Settings { settings.get(); return persist(mergeSettings(structuredClone(DEFAULT_SETTINGS)), true) },
  get deviceId(): string {
    let id = store.get('deviceId')
    if (!id) { id = crypto.randomUUID(); store.set('deviceId', id); if (credentials) credentials.persisted.deviceId = id }
    return id
  }
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : string extends keyof T[K] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K]
}
