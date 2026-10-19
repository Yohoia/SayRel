import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'

type Listener = (...args: unknown[]) => void

/**
 * Renderer-facing bridge.
 *
 * Listeners are namespaced per window so that two windows using the same
 * channel name do not receive each other's events. The namespace is injected
 * by the main process via an additional argument on `loadFile`/`loadURL`.
 */
const listeners = new Map<string, Set<Listener>>()

function subscribe(channel: string, listener: Listener): () => void {
  const wrapped = (_event: unknown, ...args: unknown[]) => listener(...args)
  const set = listeners.get(channel) ?? new Set()
  set.add(wrapped)
  listeners.set(channel, set)
  ipcRenderer.on(channel, wrapped)
  return () => {
    set.delete(wrapped)
    ipcRenderer.removeListener(channel, wrapped)
  }
}

function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

function send(channel: string, ...args: unknown[]): void {
  ipcRenderer.send(channel, ...args)
}

const api = {
  // ---- generic transport -------------------------------------------------
  invoke,
  send,
  on: subscribe,
  once(channel: string, listener: Listener): void {
    ipcRenderer.once(channel, (_e, ...args) => listener(...args))
  },

  // ---- appearance --------------------------------------------------------
  appearance: {
    getColorMode: () => invoke('appearance:get-color-mode'),
    getState: (userId?: string) => invoke('appearance:get-state', userId),
    setPreference: (mode: string, userId?: string) =>
      invoke('appearance:set-preference', mode, userId),
    onColorModeChanged: (cb: Listener) => subscribe('appearance:color-mode-changed', cb)
  },

  // ---- app ---------------------------------------------------------------
  app: {
    restart: () => invoke('app:restart'),
    getSystemInfo: () => invoke('troubleshooting:get-system-info'),
    platform: process.platform,
    arch: process.arch,
    isPackaged: process.env.NODE_ENV === 'production'
  },

  // ---- audio -------------------------------------------------------------
  audio: {
    getDevices: () => invoke('audio:get-devices-async'),
    isMuted: () => invoke('audio:is-muted'),
    mute: () => invoke('audio:mute'),
    unmute: () => invoke('audio:unmute'),
    compressByBuffer: (payload: { pcm: ArrayBuffer; sampleRate: number; channels: number; bitrate: number }) =>
      invoke('audio:opus-compress-by-buffer', payload),
    compressByAudioId: (audioId: string, payload: unknown) =>
      invoke('audio:opus-compress-by-audio-id', audioId, payload),
    chunkSessionStart: (audioId: string, opts?: unknown) =>
      invoke('audio:opus-chunk-session-start', audioId, opts),
    chunkSessionEncode: (audioId: string, pcm: ArrayBuffer) =>
      invoke('audio:opus-chunk-session-encode', audioId, pcm),
    chunkSessionEnd: (audioId: string) => invoke('audio:opus-chunk-session-end', audioId),
    cleanOpusFile: (path: string) => invoke('audio:clean-opus-audio-file', path),
    aiVoiceFlow: (payload: unknown) => invoke('audio:ai-voice-flow', payload),
    abortAiVoiceFlow: (id: string) => invoke('audio:abort-ai-voice-flow-request', id),
    onAiVoiceFlowStatus: (cb: Listener) => subscribe('audio:ai-voice-flow', cb)
  },

  // ---- auth --------------------------------------------------------------
  auth: {
    getAccessToken: () => invoke('auth:get-access-token'),
    getCurrent: () => invoke('auth:get-current'),
    isLoggedIn: () => invoke('auth:is-logged-in'),
    login: (payload?: unknown) => invoke('auth:login', payload),
    logout: () => invoke('auth:logout'),
    startAppLogin: () => invoke('auth:start-app-login'),
    onLoginLoadingChanged: (cb: Listener) => subscribe('auth:app-login-loading-changed', cb),
    onLoginFailed: (cb: Listener) => subscribe('auth:app-login-failed', cb)
  },

  // ---- clipboard ---------------------------------------------------------
  clipboard: {
    writeText: (text: string) => invoke('clipboard:write-text', text),
    writeImage: (dataUrl: string) => invoke('clipboard:write-image', dataUrl)
  },

  // ---- context -----------------------------------------------------------
  context: {
    getAppIcon: (bundleId: string) => invoke('context:get-app-icon', bundleId)
  },

  // ---- database ----------------------------------------------------------
  db: {
    getDeviceId: () => invoke('db:get-device-id'),
    historyClear: (opts?: unknown) => invoke('db:history-clear', opts),
    historyDelete: (id: string) => invoke('db:history-delete', id),
    historyDeleteByDuration: (ms: number) => invoke('db:history-delete-by-duration', ms),
    historyGet: (id: string) => invoke('db:history-get', id),
    historyLatest: (limit?: number) => invoke('db:history-latest', limit),
    historyLatestId: () => invoke('db:history-latest-id'),
    historyList: (query?: unknown) => invoke('db:history-list', query),
    historySaveAudio: (id: string, data: ArrayBuffer) => invoke('db:history-save-audio', id, data),
    historyUpsert: (payload: unknown) => invoke('db:history-upsert', payload),
    historyUpsertClientMetadata: (id: string, meta: unknown) =>
      invoke('db:history-upsert-client-metadata', id, meta),
    historyUpsertModeMeta: (id: string, meta: unknown) =>
      invoke('db:history-upsert-mode-meta', id, meta),
    historyV2MigrationStart: () => invoke('db:history-v2-migration-start'),
    triggerDiskCleanup: () => invoke('db:history-trigger-disk-cleanup'),
    triggerHistoryCleanup: () => invoke('db:history-trigger-history-cleanup')
  },

  // ---- dictionary --------------------------------------------------------
  dictionary: {
    list: () => invoke('dictionary:list'),
    add: (word: string, opts?: unknown) => invoke('dictionary:add', word, opts),
    remove: (id: string) => invoke('dictionary:remove', id),
    onWordAutoAdded: (cb: Listener) => subscribe('dictionary:word-auto-added', cb)
  },

  // ---- device ------------------------------------------------------------
  device: {
    getInfo: () => invoke('device:get-info'),
    isLidOpen: () => invoke('device:is-lid-open')
  },

  // ---- files -------------------------------------------------------------
  files: {
    clearLog: () => invoke('file:clear-log'),
    openLog: () => invoke('file:open-log'),
    openRecordings: () => invoke('file:open-recordings'),
    pickAndParseDictionaryCsv: () => invoke('file:pick-and-parse-dictionary-csv'),
    readRecordingsSize: () => invoke('file:read-recordings-size'),
    saveAudioWithDialog: (payload?: unknown) => invoke('file:save-audio-with-dialog', payload),
    savePngWithDialog: (dataUrl: string, name?: string) =>
      invoke('file:save-png-with-dialog', dataUrl, name),
    saveRecordingLog: (payload: unknown) => invoke('file:save-recording-log', payload)
  },

  // ---- i18n --------------------------------------------------------------
  i18n: {
    getLanguage: () => invoke('i18n:get-language'),
    setLanguage: (locale: string) => invoke('i18n:set-language', locale),
    resetToSystemLanguage: () => invoke('i18n:reset-to-system-language'),
    onLanguageChanged: (cb: Listener) => subscribe('i18n:language-changed', cb)
  },

  // ---- keyboard ----------------------------------------------------------
  keyboard: {
    setWatcherInterval: (ms: number) => invoke('keyboard:set-watcher-interval', ms),
    start: () => invoke('keyboard:start-keyboard-listener'),
    stop: () => invoke('keyboard:stop-keyboard-listener'),
    typeTranscript: (text: string) => invoke('keyboard:type-transcript', text)
  },

  // ---- analytics ---------------------------------------------------------
  mixpanel: {
    track: (event: string, props?: Record<string, unknown>) =>
      invoke('mixpanel:track-event', event, props)
  },

  // ---- onboarding --------------------------------------------------------
  onboarding: {
    getSurveys: () => invoke('onboarding:get-user-profile-surveys'),
    submitSurvey: (payload: unknown) => invoke('onboarding:submit-user-profile-survey', payload)
  },

  // ---- pages / windows ---------------------------------------------------
  page: {
    changeHubRoute: (route: string) => invoke('page:change-hub-route', route),
    closeAllDevtools: () => invoke('page:close-all-devtools'),
    closeInteractiveCard: () => invoke('page:close-interactive-card'),
    closeSidebar: () => invoke('page:close-sidebar'),
    completeOnboarding: () => invoke('page:complete-onboarding'),
    floatingBarClick: (action: string, payload?: unknown) =>
      invoke('page:floating-bar-click', action, payload),
    floatingBarSetAlwaysOnTop: (value: boolean) =>
      invoke('page:floating-bar-set-always-on-top-for-windows', value),
    floatingBarSetExpanded: (expanded: boolean) => invoke('page:floating-bar-set-expanded', expanded),
    floatingBarUpdatePositions: (rects: unknown) =>
      invoke('page:floating-bar-update-positions', rects),
    getInteractiveCardPayload: () => invoke('page:get-interactive-card-payload'),
    isOnboardingVisible: () => invoke('page:is-onboarding-window-visible'),
    launchApplication: (name: string) => invoke('page:launch-application', name),
    openDevtools: () => invoke('page:open-devtools'),
    openEntryWindow: () => invoke('page:open-entry-window'),
    openHub: (route?: string) => invoke('page:open-hub', route),
    openInteractiveCard: (payload: unknown) => invoke('page:open-interactive-card', payload),
    openSettingsModal: (section?: string) => invoke('page:open-settings-modal', section),
    openSidebar: (payload?: unknown) => invoke('page:open-sidebar', payload),
    openBar: () => invoke('page:open-typeless-bar'),
    openUrl: (url: string) => invoke('page:open-url', url),
    restartBar: () => invoke('page:restart-typeless-bar'),
    setHubWindowButtonVisibility: (visible: boolean) =>
      invoke('page:set-hub-window-button-visibility', visible),
    updateInteractiveCardBounds: (bounds: unknown) =>
      invoke('page:update-interactive-card-bounds', bounds),
    onWindowClosed: (cb: Listener) => subscribe('page:window-closed', cb),
    onWindowCreated: (cb: Listener) => subscribe('page:window-created', cb)
  },

  // ---- permissions -------------------------------------------------------
  permission: {
    checkWithChildProcess: (kind: string) => invoke('permission:check-with-child-process', kind),
    diagnoseMicrophone: () => invoke('permission:diagnose-microphone'),
    request: (kind: string) => invoke('permission:request', kind),
    resetAccessibility: () => invoke('permission:reset-accessibility-permission'),
    updateAutoLaunch: (enabled: boolean) => invoke('permission:update-auto-launch', enabled),
    updateShowAppInDock: (show: boolean) => invoke('permission:update-show-app-in-dock', show)
  },

  // ---- recording machine -------------------------------------------------
  recording: {
    setDisabled: (disabled: boolean) => invoke('recording-machine:set-disabled', disabled),
    getDisabled: () => invoke('recording-machine:get-disabled'),
    onDisabledChanged: (cb: Listener) => subscribe('recording-machine:disabled-changed', cb),
    status: (phase: string, payload?: unknown) =>
      invoke('recording-machine:status', phase, payload),
    state: () => invoke('recording-machine:state')
  },

  // ---- settings ----------------------------------------------------------
  settings: {
    get: () => invoke('store:use', 'get'),
    patch: (partial: unknown) => invoke('store:use', 'patch', partial),
    reset: () => invoke('store:use', 'reset')
  },

  // ---- rsa ---------------------------------------------------------------
  rsa: {
    clear: () => invoke('rsa:clear'),
    encrypt: (value: string) => invoke('rsa:encrypt', value),
    getConfig: () => invoke('rsa:get-config'),
    isEnabled: () => invoke('rsa:is-enabled'),
    setConfig: (config: unknown) => invoke('rsa:set-config', config)
  },

  // ---- sync --------------------------------------------------------------
  sync: {
    onStateChanged: (cb: Listener) => subscribe('sync:state-changed', cb),
    onError: (cb: Listener) => subscribe('sync:error', cb),
    onPullDone: (cb: Listener) => subscribe('sync:channel-pull-done', cb),
    trigger: () => invoke('sync:trigger')
  },

  // ---- updater -----------------------------------------------------------
  updater: {
    check: () => invoke('updater:check-for-update'),
    checkAndDownloadSilently: () => invoke('updater:check-update-and-download-silently'),
    download: () => invoke('updater:download-update'),
    quitAndInstall: () => invoke('updater:quit-and-install'),
    onChecking: (cb: Listener) => subscribe('updater:checking-for-update', cb),
    onAvailable: (cb: Listener) => subscribe('updater:update-available', cb),
    onProgress: (cb: Listener) => subscribe('updater:download-progress', cb),
    onDownloaded: (cb: Listener) => subscribe('updater:update-downloaded', cb),
    onError: (cb: Listener) => subscribe('updater:update-error', cb),
    onNotAvailable: (cb: Listener) => subscribe('updater:update-not-available', cb)
  }
}

export type OffkeyApi = typeof api

contextBridge.exposeInMainWorld('offkey', api)
// The reference build exposes `window.ipcRenderer`; keep the alias so bundled
// renderer code can use either name.
contextBridge.exposeInMainWorld('ipcRenderer', api)
