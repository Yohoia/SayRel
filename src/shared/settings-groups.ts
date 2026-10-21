/**
 * Refactored Settings Structure
 *
 * Split the monolithic 79-field Settings into logical groups
 * for better maintainability and type safety.
 */

import { EMPTY_SERVICE_PROVIDERS, serviceProvidersSchema, type ServiceProviders } from './providers'
import { normalizeTranslationTargets } from './settingsControls'
import { MODES, type Mode } from './constants'

export type ColorMode = 'light' | 'dark' | 'system'
export type ShortcutStyle = 'hold' | 'toggle'

export interface ShortcutBinding {
  accelerator: string
  style: ShortcutStyle
  enabled: boolean
}

// ===== Grouped Settings =====

export interface GeneralSettings {
  launchAtLogin: boolean
  showInDock: boolean
  language: string | null
  autoUpdate: boolean
}

export interface AppearanceSettings {
  appearancePreference: ColorMode
  appearancePreferenceByUserId: Record<string, ColorMode>
}

export interface DictationSettings {
  dictationMode: Mode
  pushToTalk: boolean
  shortcut: ShortcutBinding
  commandShortcut: ShortcutBinding
  askAnythingShortcut: ShortcutBinding
  translationShortcut: ShortcutBinding
  additionalShortcuts: Record<string, ShortcutBinding>
  translationTargetLanguages: string[]
  translationTargetLanguage: string
  translationSourceLanguage: string | null
  recordingTimeout: number
}

export interface AudioSettings {
  micDeviceId: string | null
  playSoundOnRecord: boolean
  muteWhileDictating: boolean
}

export interface PrivacySettings {
  sendAnalytics: boolean
  sendCrashReports: boolean
  improveAccuracy: boolean
  screenContentCaptureEnabled: boolean
  screenContentScope: 'focused-window' | 'all-windows'
}

export interface ProviderSettings {
  provider: {
    type: 'offkey' | 'openai' | 'openai-compatible' | 'mock'
    baseUrl: string | null
    apiKey: string | null
    model: string | null
    refinementModel: string | null
  }
  serviceProviders: ServiceProviders
}

export interface OnboardingSettings {
  onboardingCompleted: boolean
  onboardingStep: number | null
  defaultModeSelected: boolean
}

/**
 * Main Settings interface - now composed of logical groups
 */
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
  additionalShortcuts: Record<string, ShortcutBinding>
  translationTargetLanguages: string[]
  translationTargetLanguage: string
  translationSourceLanguage: string | null
  recordingTimeout: number

  // Audio
  micDeviceId: string | null
  playSoundOnRecord: boolean
  muteWhileDictating: boolean

  // Privacy
  sendAnalytics: boolean
  sendCrashReports: boolean
  improveAccuracy: boolean
  screenContentCaptureEnabled: boolean
  screenContentScope: 'focused-window' | 'all-windows'

  // Provider
  provider: {
    type: 'offkey' | 'openai' | 'openai-compatible' | 'mock'
    baseUrl: string | null
    apiKey: string | null
    model: string | null
    refinementModel: string | null
  }
  serviceProviders: ServiceProviders

  // Onboarding
  onboardingCompleted: boolean
  onboardingStep: number | null
  defaultModeSelected: boolean
}

/**
 * Helper functions to extract grouped settings
 */
export const SettingsGroups = {
  general(settings: Settings): GeneralSettings {
    return {
      launchAtLogin: settings.launchAtLogin,
      showInDock: settings.showInDock,
      language: settings.language,
      autoUpdate: settings.autoUpdate
    }
  },

  appearance(settings: Settings): AppearanceSettings {
    return {
      appearancePreference: settings.appearancePreference,
      appearancePreferenceByUserId: settings.appearancePreferenceByUserId
    }
  },

  dictation(settings: Settings): DictationSettings {
    return {
      dictationMode: settings.dictationMode,
      pushToTalk: settings.pushToTalk,
      shortcut: settings.shortcut,
      commandShortcut: settings.commandShortcut,
      askAnythingShortcut: settings.askAnythingShortcut,
      translationShortcut: settings.translationShortcut,
      additionalShortcuts: settings.additionalShortcuts,
      translationTargetLanguages: settings.translationTargetLanguages,
      translationTargetLanguage: settings.translationTargetLanguage,
      translationSourceLanguage: settings.translationSourceLanguage,
      recordingTimeout: settings.recordingTimeout
    }
  },

  audio(settings: Settings): AudioSettings {
    return {
      micDeviceId: settings.micDeviceId,
      playSoundOnRecord: settings.playSoundOnRecord,
      muteWhileDictating: settings.muteWhileDictating
    }
  },

  privacy(settings: Settings): PrivacySettings {
    return {
      sendAnalytics: settings.sendAnalytics,
      sendCrashReports: settings.sendCrashReports,
      improveAccuracy: settings.improveAccuracy,
      screenContentCaptureEnabled: settings.screenContentCaptureEnabled,
      screenContentScope: settings.screenContentScope
    }
  },

  provider(settings: Settings): ProviderSettings {
    return {
      provider: settings.provider,
      serviceProviders: settings.serviceProviders
    }
  },

  onboarding(settings: Settings): OnboardingSettings {
    return {
      onboardingCompleted: settings.onboardingCompleted,
      onboardingStep: settings.onboardingStep,
      defaultModeSelected: settings.defaultModeSelected
    }
  }
}
