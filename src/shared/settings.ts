import { EMPTY_SERVICE_PROVIDERS, providerConfigurationIssue, serviceProvidersSchema, type ServiceProviders, type ProviderProfile } from './providers'
import { normalizeShortcut, normalizeTranslationTargets } from './settingsControls'
import { MODES, type Mode } from './constants'
import { z } from 'zod'

export const writingPreferencesSchema = z.object({
  polishLevel: z.enum(['raw', 'light', 'strong']).optional(),
  writingStyle: z.enum(['neutral', 'formal', 'casual', 'concise']).optional(),
  dictionaryLearning: z.boolean().optional(), desktopCommandsEnabled: z.boolean().optional(),
  autoPunctuation: z.boolean().optional(), autoDetectLanguage: z.boolean().optional(),
  transcriptionLanguage: z.string().trim().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).nullable().optional()
})

export type ColorMode = 'light' | 'dark' | 'system'
export type ShortcutStyle = 'hold' | 'toggle'

// IPC preserves error messages, but not custom properties on Error instances.
export const SETTINGS_EFFECT_ERRORS = {
  language: 'Settings saved, but language could not be applied. Please try again.',
  appearance: 'Settings saved, but appearance could not be applied. Please try again.',
  shortcuts: 'Settings saved, but shortcuts could not be applied. Please try again.',
  login: 'Settings saved, but launch at startup could not be applied. Please try again.',
  dock: 'Settings saved, but Dock visibility could not be applied. Please try again.'
}

export interface ShortcutBinding {
  /** Electron accelerator string, e.g. `Fn`, `RightShift`, `Alt+Space`. */
  accelerator: string
  /** Hold to talk, or press once to start and once to stop. */
  style: ShortcutStyle
  enabled: boolean
}

export interface Settings {
  // General
  launchAtLogin: boolean
  showInDock: boolean
  language: string | null
  autoUpdate: boolean

  // Appearance
  appearancePreference: ColorMode

  // Dictation
  dictationMode: Mode
  pushToTalk: boolean
  shortcut: ShortcutBinding
  commandShortcut: ShortcutBinding
  desktopCommandShortcut: ShortcutBinding
  askAnythingShortcut: ShortcutBinding
  translationShortcut: ShortcutBinding
  additionalShortcuts: Partial<Record<'shortcut' | 'translationShortcut' | 'askAnythingShortcut' | 'desktopCommandShortcut', ShortcutBinding[]>>
  translationTargetLanguages: string[]
  translationTargetLanguage: string
  muteWhileDictating: boolean
  micDevice: string | null
  autoPunctuation: boolean
  addTrailingSpace: boolean
  playSoundOnRecord: boolean
  soundVolume: number

  // Recognition
  transcriptionLanguage: string | null
  autoDetectLanguage: boolean
  preferredLanguages: string[]

  // Writing style
  writingStyle: 'neutral' | 'formal' | 'casual' | 'concise'
  polishLevel: 'raw' | 'light' | 'strong'
  dictionaryLearning: boolean
  desktopCommandsEnabled: boolean
  customInstructions: string

  // Privacy
  historyEnabled: boolean
  saveAudio: boolean
  audioRetentionDays: number
  historyRetentionDays: number
  sendScreenContext: boolean
  sendFocusedAppContext: boolean
  telemetryEnabled: boolean

  // Advanced
  provider: {
    transcription: 'sayrel-cloud' | 'openai-compatible' | 'local-whisper' | 'mock'
    refinement: 'sayrel-cloud' | 'openai-compatible' | 'mock'
    baseUrl: string | null
    apiKey: string | null
    model: string | null
    refinementModel: string | null
  }

  serviceProviders: ServiceProviders
  /** Runtime-only profile IDs whose encrypted credentials need recovery. */
  providerCredentialsUnavailable: string[]

  // Onboarding
  onboardingCompleted: boolean
  onboardingStep: number | null
  defaultModeSelected: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  launchAtLogin: false,
  showInDock: true,
  language: 'en',
  autoUpdate: true,

  appearancePreference: 'system',

  dictationMode: MODES.VOICE_TRANSCRIPT,
  pushToTalk: true,
  shortcut: { accelerator: 'Fn', style: 'toggle', enabled: true },
  commandShortcut: { accelerator: '', style: 'toggle', enabled: false },
  desktopCommandShortcut: { accelerator: '', style: 'toggle', enabled: false },
  askAnythingShortcut: { accelerator: 'Fn+Space', style: 'toggle', enabled: true },
  translationShortcut: { accelerator: 'Fn+Shift', style: 'toggle', enabled: true },
  additionalShortcuts: {},
  translationTargetLanguages: ['en'],
  translationTargetLanguage: 'en',
  muteWhileDictating: true,
  micDevice: null,
  autoPunctuation: true,
  addTrailingSpace: true,
  playSoundOnRecord: true,
  soundVolume: 0.6,

  transcriptionLanguage: null,
  autoDetectLanguage: true,
  preferredLanguages: [],

  writingStyle: 'neutral',
  polishLevel: 'light',
  dictionaryLearning: false,
  desktopCommandsEnabled: false,
  customInstructions: '',

  historyEnabled: true,
  saveAudio: true,
  audioRetentionDays: 30,
  historyRetentionDays: 0,
  sendScreenContext: false,
  sendFocusedAppContext: true,
  telemetryEnabled: false,


  // Configure recognition and refinement through the persisted provider settings.
  provider: {
    transcription: 'openai-compatible',
    refinement: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: null,
    model: 'whisper-1',
    refinementModel: 'gpt-4o-mini'
  },

  serviceProviders: EMPTY_SERVICE_PROVIDERS,
  providerCredentialsUnavailable: [],

  onboardingCompleted: false,
  onboardingStep: null,
  defaultModeSelected: false
}

/** Shallow-merge a persisted partial settings object over the defaults. */
export function mergeSettings(persisted: Partial<Settings> | undefined): Settings {
  // Migrate the previous reconstruction's defaults to the reference gestures.
  // Explicit custom bindings retain their chosen behavior.
  if (persisted && !persisted.translationShortcut) {
    persisted = { ...persisted }
    if (persisted.commandShortcut?.accelerator === 'Fn+Shift') {
      persisted.translationShortcut = { ...persisted.commandShortcut, style: 'toggle' }
      persisted.commandShortcut = { ...DEFAULT_SETTINGS.commandShortcut }
    }
    for (const key of ['shortcut', 'askAnythingShortcut'] as const) {
      if (persisted[key]?.accelerator === DEFAULT_SETTINGS[key].accelerator) {
        persisted[key] = { ...persisted[key]!, style: 'toggle' }
      }
    }
  }

  // Helper to merge nested objects
  const mergeNested = <T extends object>(base: T, partial: Partial<T> | undefined): T => {
    return { ...base, ...(partial ?? {}) }
  }

  const mergeBinding = (base: ShortcutBinding, partial: Partial<ShortcutBinding> | undefined): ShortcutBinding => {
    const binding = mergeNested(base, partial)
    return { ...binding, accelerator: normalizeShortcut(binding.accelerator) }
  }
  const provider = mergeNested(DEFAULT_SETTINGS.provider, persisted?.provider)
  const migrateCloudName = <T extends string>(name: T): T | 'sayrel-cloud' => name === 'offkey-cloud' ? 'sayrel-cloud' : name
  return {
    ...DEFAULT_SETTINGS,
    ...Object.fromEntries(Object.entries(persisted ?? {}).filter(([key]) => key in DEFAULT_SETTINGS)),
    polishLevel: z.enum(['raw', 'light', 'strong']).catch('light').parse(persisted?.polishLevel),
    writingStyle: z.enum(['neutral', 'formal', 'casual', 'concise']).catch('neutral').parse(persisted?.writingStyle),
    dictionaryLearning: persisted?.dictionaryLearning === true,
    desktopCommandsEnabled: persisted?.desktopCommandsEnabled === true,
    ...normalizeTranslationTargets(
      persisted?.translationTargetLanguages ?? [persisted?.translationTargetLanguage ?? 'en'],
      persisted?.translationTargetLanguage ?? 'en'
    ),
    additionalShortcuts: Object.fromEntries(Object.entries(persisted?.additionalShortcuts ?? {}).map(([key, bindings]) => [key, bindings.map(binding => mergeBinding(binding, undefined))])),
    shortcut: mergeBinding(DEFAULT_SETTINGS.shortcut, persisted?.shortcut),
    commandShortcut: mergeBinding(DEFAULT_SETTINGS.commandShortcut, persisted?.commandShortcut),
    desktopCommandShortcut: mergeBinding(DEFAULT_SETTINGS.desktopCommandShortcut, persisted?.desktopCommandShortcut),
    askAnythingShortcut: mergeBinding(DEFAULT_SETTINGS.askAnythingShortcut, persisted?.askAnythingShortcut),
    translationShortcut: mergeBinding(DEFAULT_SETTINGS.translationShortcut, persisted?.translationShortcut),
    provider: { ...provider, apiKey: null, transcription: migrateCloudName(provider.transcription), refinement: migrateCloudName(provider.refinement) },
    serviceProviders: persisted?.serviceProviders
      ? serviceProvidersSchema.parse(persisted.serviceProviders)
      : migrateProviderSettings(persisted?.provider)
  }
}

function migrateProviderSettings(legacy: Settings['provider'] | undefined): ServiceProviders {
  if (!legacy) return { ...EMPTY_SERVICE_PROVIDERS, profiles: [] }
  const endpoint = legacy.baseUrl ?? 'https://api.openai.com/v1'
  const apiKey = legacy.apiKey ?? ''
  const fields = { enabled: true, appId: '', accessToken: '', resourceId: '', apiVersion: '2024-10-21' }
  const state: ServiceProviders = { profiles: [], transcription: null, refinement: null }
  if (legacy.transcription !== 'mock' && (legacy.transcription !== 'local-whisper' || legacy.baseUrl)) {
    const local = legacy.transcription === 'local-whisper'
    const model = local ? legacy.baseUrl || '' : legacy.model || 'whisper-1'
    const profile: ProviderProfile = { ...fields, id: 'migrated-transcription', presetId: local ? 'asr-local-whisper' : 'asr-openai', name: local ? 'Whisper' : "Transcription", service: 'transcription', protocol: local ? 'local-whisper' : 'openai-transcription', endpoint: local ? legacy.model || 'whisper-cli' : endpoint, apiKey: local ? '' : apiKey, models: [model] }
    state.profiles.push(profile)
    if (!providerConfigurationIssue(profile)) state.transcription = { providerId: profile.id, model }
  }
  if (legacy.refinement !== 'mock') {
    const model = legacy.refinementModel || legacy.model || 'gpt-4o-mini'
    const profile: ProviderProfile = { ...fields, id: 'migrated-refinement', presetId: 'llm-openai_compatible', name: "Text refinement", service: 'refinement', protocol: 'openai-chat', endpoint, apiKey, models: [model], thinkingMode: 'auto' }
    state.profiles.push(profile)
    // Empty old keys should lead to an unconfigured role, even for compatible endpoints.
    if (apiKey || /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/.test(endpoint)) state.refinement = { providerId: profile.id, model }
  }
  return serviceProvidersSchema.parse(state)
}
