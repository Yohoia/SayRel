import { normalizeTranslationTargets } from './settingsControls'
import { MODES, type Mode } from './constants'

export type ColorMode = 'light' | 'dark' | 'system'
export type ShortcutStyle = 'hold' | 'toggle'

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
  appearancePreferenceByUserId: Record<string, ColorMode>

  // Dictation
  dictationMode: Mode
  pushToTalk: boolean
  shortcut: ShortcutBinding
  commandShortcut: ShortcutBinding
  askAnythingShortcut: ShortcutBinding
  translationShortcut: ShortcutBinding
  additionalShortcuts: Partial<Record<'shortcut' | 'translationShortcut' | 'askAnythingShortcut', ShortcutBinding[]>>
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
  customInstructions: string

  // Privacy
  historyEnabled: boolean
  saveAudio: boolean
  audioRetentionDays: number
  historyRetentionDays: number
  sendScreenContext: boolean
  sendFocusedAppContext: boolean
  telemetryEnabled: boolean

  // Sync
  syncEnabled: boolean
  syncIntervalMs: number

  // Advanced
  provider: {
    transcription: 'offkey-cloud' | 'openai-compatible' | 'local-whisper' | 'mock'
    refinement: 'offkey-cloud' | 'openai-compatible' | 'mock'
    baseUrl: string | null
    apiKey: string | null
    model: string | null
    refinementModel: string | null
  }

  // Onboarding
  onboardingCompleted: boolean
  onboardingStep: number | null
  defaultModeSelected: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  launchAtLogin: false,
  showInDock: true,
  language: 'zh-CN',
  autoUpdate: true,

  appearancePreference: 'system',
  appearancePreferenceByUserId: {},

  dictationMode: MODES.VOICE_TRANSCRIPT,
  pushToTalk: true,
  shortcut: { accelerator: 'Fn', style: 'toggle', enabled: true },
  commandShortcut: { accelerator: '', style: 'toggle', enabled: false },
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
  customInstructions: '',

  historyEnabled: true,
  saveAudio: true,
  audioRetentionDays: 30,
  historyRetentionDays: 0,
  sendScreenContext: false,
  sendFocusedAppContext: true,
  telemetryEnabled: false,

  syncEnabled: true,
  syncIntervalMs: 60_000,

  // Ships with a self-contained pipeline so a fresh install dictates with no
  // account. Point these at any OpenAI-compatible server (or an Offkey Cloud
  // deployment) through the existing persisted provider configuration.
  provider: {
    transcription: 'openai-compatible',
    refinement: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: null,
    model: 'whisper-1',
    refinementModel: 'gpt-4o-mini'
  },

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
  return {
    ...DEFAULT_SETTINGS,
    ...(persisted ?? {}),
    ...normalizeTranslationTargets(persisted?.translationTargetLanguages ?? [persisted?.translationTargetLanguage ?? 'en'], persisted?.translationTargetLanguage ?? 'en'),
    additionalShortcuts: persisted?.additionalShortcuts ?? {},
    shortcut: { ...DEFAULT_SETTINGS.shortcut, ...(persisted?.shortcut ?? {}) },
    commandShortcut: { ...DEFAULT_SETTINGS.commandShortcut, ...(persisted?.commandShortcut ?? {}) },
    askAnythingShortcut: {
      ...DEFAULT_SETTINGS.askAnythingShortcut,
      ...(persisted?.askAnythingShortcut ?? {})
    },
    translationShortcut: { ...DEFAULT_SETTINGS.translationShortcut, ...(persisted?.translationShortcut ?? {}) },
    provider: { ...DEFAULT_SETTINGS.provider, ...(persisted?.provider ?? {}) }
  }
}
