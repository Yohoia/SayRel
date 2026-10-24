/**
 * Product-level constants.
 *
 * `PRODUCT` is the single switch between the reference build and this one:
 * every user-visible identifier, app-data directory, URL scheme and IPC
 * namespace derives from it.
 */
export const PRODUCT = {
  name: 'Sayrel',
  displayName: 'Sayrel',
  bundleId: 'com.sayrel.app',
  urlScheme: 'sayrel',
  version: '1.0.0',
  environment: 'prod'
} as const

/** Renderer entry points, one BrowserWindow per page. */
export const WINDOWS = {
  HUB: 'hub.html',
  FLOATING_BAR: 'floating-bar.html',
  ONBOARDING: 'onboarding.html',
  SIDEBAR: 'sidebar.html',
  INTERACTIVE_CARD: 'interactive-card.html'
} as const

export type WindowRoute = (typeof WINDOWS)[keyof typeof WINDOWS]

/** Hub routes. */
export const HUB_ROUTES = {
  DASHBOARD: '/dashboard',
  HISTORY: '/history',
  DICTIONARY: '/dictionary',
  SETTINGS: '/settings'
} as const

/**
 * Dictation modes. `voice_transcript` and `voice_command` come from the
 * core product; `ask_anything` is the free-form assistant mode.
 */
export const MODES = {
  VOICE_TRANSCRIPT: 'voice_transcript',
  VOICE_COMMAND: 'voice_command',
  DESKTOP_COMMAND: 'desktop_command',
  ASK_ANYTHING: 'ask_anything',
  TRANSLATION: 'translation'
} as const

export type Mode = (typeof MODES)[keyof typeof MODES]

/** History row lifecycle. */
export const HISTORY_STATUS = {
  RECORDING: 'recording',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
} as const

export type HistoryStatus = (typeof HISTORY_STATUS)[keyof typeof HISTORY_STATUS]


/** How an AI result reaches the user. */
export const DELIVERY = {
  INSERT: 'insert',
  CLIPBOARD: 'clipboard',
  EXTERNAL: 'external',
  CARD: 'card'
} as const

export type Delivery = (typeof DELIVERY)[keyof typeof DELIVERY]

/** Audio pipeline constants, mirrored by the native helpers. */
export const AUDIO = {
  SAMPLE_RATE: 16000,
  CHANNELS: 1,
  BITRATE_BPS: 32000,
  OPUS_COMPLEXITY: 9,
  CHUNK_MS: 100
} as const
