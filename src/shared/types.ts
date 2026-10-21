import type { Delivery, HistoryStatus, Mode, SyncStatus } from './constants'

export interface FocusedAppInfo {
  appName: string | null
  bundleId: string | null
  windowTitle: string | null
  webTitle: string | null
  webDomain: string | null
  webUrl: string | null
  iconDataUrl?: string | null
  capturedAt: number
}

export interface FocusedInputInfo {
  role: string | null
  valuePreview: string | null
  selectedText: string | null
  isSecure: boolean
  bounds?: { x: number; y: number; width: number; height: number } | null
}

export interface AudioContextSnapshot {
  focusedApp: FocusedAppInfo | null
  focusedInput: FocusedInputInfo | null
  visibleText: string | null
  screenContent?: string | null
}

export interface AudioDeviceInfo {
  deviceId: string
  label: string
  isDefault: boolean
  transport?: string | null
}

export interface MicDeviceInfo {
  deviceId: string
  label: string
  sampleRate?: number | null
  transport?: string | null
}

/**
 * Mode metadata - uses discriminated union to prevent invalid states
 */
export type ModeMeta =
  | { kind: 'ai'; aiResult: AiResult }
  | { kind: 'command'; command: string }
  | { kind: 'empty' }

export interface AiResult {
  text: string
  delivery: Delivery
  title?: string | null
  payload?: unknown
}

export interface HistoryRecord {
  id: string
  userId: string | null
  status: HistoryStatus | string | null
  mode: Mode | string
  refinedText: string | null
  duration: number | null
  createdAt: string | null
  updatedAt: string | null
  audioLocalPath: string | null
  audioMetadata: string | null
  appVersion: string
  micDevice: string | null
  micDeviceInfo: Buffer | null
  clientMetadata: Buffer | null
  modeMeta: string | null
  debugInfo: string | null
  audioContext: string | null
  serverUpdatedAt: number | null
  syncStatus: SyncStatus | string
  syncAttemptCount: number
  syncedFromCloud: number
}

export interface HistoryListItem {
  id: string
  refinedText: string | null
  status: string | null
  mode: string
  duration: number | null
  createdAt: string | null
  focusedAppName: string | null
  focusedAppBundleId: string | null
  detectedLanguage: string | null
  audioLocalPath: string | null
  hasAudio: boolean
}

export interface HistoryListQuery {
  userId?: string | null
  limit?: number
  offset?: number
  cursor?: string | null
  status?: string | null
  mode?: string | null
  appName?: string | null
  search?: string | null
  from?: string | null
  to?: string | null
}

export interface HistoryListResult {
  items: HistoryListItem[]
  total: number
  nextCursor: string | null
}

export interface UserInfo {
  id: string
  email: string | null
  name: string | null
  avatarUrl: string | null
  plan: string | null
  locale: string | null
  createdAt?: string | null
}

export interface AuthSession {
  userId: string
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null
  user: UserInfo | null
}

export interface AppearanceState {
  colorMode: 'light' | 'dark' | 'system'
  resolved: 'light' | 'dark'
  preferenceByUserId: Record<string, string>
}

export interface DeviceInfo {
  deviceId: string
  platform: string
  arch: string
  osVersion: string
  appVersion: string
  model: string | null
  locale: string
}

export interface DictionaryEntry {
  id: string
  word: string
  source: 'manual' | 'auto' | 'csv'
  language: string | null
  createdAt: string
}

export interface TranscriptionRequest {
  pcm?: Float32Array
  sampleRate?: number
  signal?: AbortSignal
  audioPath?: string | null
  audioBuffer?: Buffer | null
  mimeType?: string | null
  durationMs: number
  language?: string | null
  languages?: string[]
  dictionary?: string[]
  context?: AudioContextSnapshot | null
  mode: Mode
}

export interface TranscriptionResult {
  text: string
  detectedLanguage: string | null
  confidence?: number | null
  provider: string
}

export interface RefineRequest {
  signal?: AbortSignal
  transcript: string
  mode: Mode
  language?: string | null
  dictionary?: string[]
  context?: AudioContextSnapshot | null
  instructions?: string | null
}

export interface RefineResult {
  text: string
  title?: string | null
  delivery: Delivery
}

export interface VoiceFlowResult {
  id: string
  transcript: string
  refined: string
  delivery: Delivery
  mode: Mode
  durationMs: number
  detectedLanguage: string | null
  error?: string | null
}

export type PermissionKind = 'microphone' | 'accessibility' | 'screenRecording'

export interface PermissionState {
  microphone: boolean
  accessibility: boolean
  screenRecording: boolean
}

export interface SyncState {
  phase: 'idle' | 'pulling' | 'pushing' | 'error'
  lastSyncedAt: number | null
  pending: number
  error?: string | null
}

export interface SystemInfo {
  appVersion: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
  platform: string
  arch: string
  osVersion: string
  locale: string
  deviceId: string
  logsPath: string
  dbPath: string
  recordingsPath: string
}

export interface UpdaterState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'not-available'
  version?: string | null
  progress?: number | null
  error?: string | null
}

/** Payload delivered to the floating bar to render a transcript bubble. */
export interface FloatingBarState {
  phase:
    | 'idle'
    | 'starting'
    | 'recording'
    | 'processing'
    | 'refining'
    | 'inserting'
    | 'done'
    | 'error'
  mode: Mode
  level: number
  elapsedMs: number
  partialText?: string | null
  message?: string | null
  expanded: boolean
}

export interface InteractiveCardPayload {
  id: string
  mode: Mode
  title: string | null
  answer: string
  createdAt: number
  bounds?: { x: number; y: number; width: number; height: number } | null
}
