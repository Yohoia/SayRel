/** Typed access to the preload bridge. */
export type Bridge = any

declare global {
  interface Window {
    offkey: Bridge
    ipcRenderer: Bridge
  }
}

export const bridge: Bridge =
  typeof window !== 'undefined' ? (window.offkey ?? window.ipcRenderer) : ({} as Bridge)

export const api = {
  settings: {
    get: () => bridge.invoke('store:use', 'get'),
    patch: (partial: unknown) => bridge.invoke('store:use', 'patch', partial),
    reset: () => bridge.invoke('store:use', 'reset')
  },
  appearance: {
    getState: () => bridge.invoke('appearance:get-state'),
    setPreference: (mode: string) => bridge.invoke('appearance:set-preference', mode),
    onChanged: (cb: (s: unknown) => void) => bridge.on('appearance:color-mode-changed', cb)
  },
  i18n: {
    getLanguage: () => bridge.invoke('i18n:get-language'),
    setLanguage: (locale: string) => bridge.invoke('i18n:set-language', locale),
    reset: () => bridge.invoke('i18n:reset-to-system-language'),
    onChanged: (cb: (locale: string) => void) => bridge.on('i18n:language-changed', cb)
  },
  history: {
    list: (query?: unknown) => bridge.invoke('db:history-list', query),
    get: (id: string) => bridge.invoke('db:history-get', id),
    latest: (limit?: number) => bridge.invoke('db:history-latest', limit),
    remove: (id: string) => bridge.invoke('db:history-delete', id),
    clear: () => bridge.invoke('db:history-clear'),
    saveAudio: (id: string, data: ArrayBuffer) =>
      bridge.invoke('db:history-save-audio', id, data),
    upsertClientMetadata: (id: string, meta: unknown) =>
      bridge.invoke('db:history-upsert-client-metadata', id, meta)
  },
  dictionary: {
    list: () => bridge.invoke('dictionary:list'),
    add: (word: string, opts?: unknown) => bridge.invoke('dictionary:add', word, opts),
    update: (id: string, word: string) => bridge.invoke('dictionary:update', id, word),
    remove: (id: string) => bridge.invoke('dictionary:remove', id)
  },
  audio: {
    getDevices: () => bridge.invoke('audio:get-devices-async'),
    isMuted: () => bridge.invoke('audio:is-muted'),
    mute: () => bridge.invoke('audio:mute'),
    unmute: () => bridge.invoke('audio:unmute')
  },
  permission: {
    check: (kind: string) => bridge.invoke('permission:check-with-child-process', kind),
    request: (kind: string) => bridge.invoke('permission:request', kind),
    diagnoseMicrophone: () => bridge.invoke('permission:diagnose-microphone'),
    updateAutoLaunch: (enabled: boolean) =>
      bridge.invoke('permission:update-auto-launch', enabled),
    updateShowAppInDock: (show: boolean) =>
      bridge.invoke('permission:update-show-app-in-dock', show),
    resetAccessibility: () => bridge.invoke('permission:reset-accessibility-permission')
  },
  page: {
    openHub: (route?: string) => bridge.invoke('page:open-hub', route),
    openSidebar: () => bridge.invoke('page:open-sidebar'),
    closeSidebar: () => bridge.invoke('page:close-sidebar'),
    openCard: (payload: unknown) => bridge.invoke('page:open-interactive-card', payload),
    closeCard: () => bridge.invoke('page:close-interactive-card'),
    cardPayload: () => bridge.invoke('page:get-interactive-card-payload'),
    openSettings: (section?: string) => bridge.invoke('page:open-settings-modal', section),
    openUrl: (url: string) => bridge.invoke('page:open-url', url),
    completeOnboarding: () => bridge.invoke('page:complete-onboarding'),
    floatingBarClick: (action: string, payload?: unknown) =>
      bridge.invoke('page:floating-bar-click', action, payload),
    setExpanded: (expanded: boolean) => bridge.invoke('page:floating-bar-set-expanded', expanded),
    updatePositions: (rects: unknown) =>
      bridge.invoke('page:floating-bar-update-positions', rects)
  },
  recording: {
    status: (phase: string, payload?: unknown) =>
      bridge.invoke('recording-machine:status', phase, payload),
    state: () => bridge.invoke('recording-machine:state'),
    setDisabled: (disabled: boolean) => bridge.invoke('recording-machine:set-disabled', disabled),
    onState: (cb: (s: unknown) => void) => bridge.on('recording-machine:state', cb)
  },
  updater: {
    check: () => bridge.invoke('updater:check-for-update'),
    install: () => bridge.invoke('updater:quit-and-install'),
    onProgress: (cb: (p: unknown) => void) => bridge.on('updater:download-progress', cb)
  },
  app: {
    restart: () => bridge.invoke('app:restart'),
    systemInfo: () => bridge.invoke('troubleshooting:get-system-info'),
    diagnostic: () => bridge.invoke('diagnostics:native-status'),
    setDock: (show: boolean) => bridge.invoke('permission:update-show-app-in-dock', show)
  },
  clipboard: {
    writeText: (text: string) => bridge.invoke('clipboard:write-text', text),
    writeImage: (dataUrl: string) => bridge.invoke('clipboard:write-image', dataUrl)
  },
  files: {
    openRecordings: () => bridge.invoke('file:open-recordings'),
    openLog: () => bridge.invoke('file:open-log'),
    importDictionary: () => bridge.invoke('file:pick-and-parse-dictionary-csv'),
    saveAudio: (payload: unknown) => bridge.invoke('file:save-audio-with-dialog', payload),
    savePng: (dataUrl: string, name?: string) =>
      bridge.invoke('file:save-png-with-dialog', dataUrl, name)
  }
}
