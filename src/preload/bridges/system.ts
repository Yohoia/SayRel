/**
 * Preload Bridge - System Domain
 *
 * Handles system-level operations and permissions
 */

type Listener = (...args: unknown[]) => void

export function createSystemBridge(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
  subscribe: (channel: string, listener: Listener) => () => void
) {
  return {
    // App info
    getSystemInfo: () => invoke('troubleshooting:get-system-info'),
    restart: () => invoke('app:restart'),

    // Permissions
    permissions: {
      check: (kind: string) => invoke('permission:check', kind),
      request: (kind: string) => invoke('permission:request', kind),
      openSystemPreferences: (kind: string) => invoke('permission:open-system-preferences', kind)
    },

    // Context capture
    context: {
      captureSnapshot: () => invoke('context:capture-snapshot'),
      getAppIcon: (bundleId: string) => invoke('context:get-app-icon', { bundleId })
    },

    // Files
    files: {
      openRecordings: () => invoke('file:open-recordings'),
      openLog: () => invoke('file:open-log'),
      importDictionary: () => invoke('file:pick-and-parse-dictionary-csv'),
      saveAudio: (payload: unknown) => invoke('file:save-audio-with-dialog', payload),
      savePng: (dataUrl: string, name?: string) => invoke('file:save-png-with-dialog', dataUrl, name)
    },

    // Clipboard
    clipboard: {
      writeText: (text: string) => invoke('clipboard:write-text', text),
      writeImage: (dataUrl: string) => invoke('clipboard:write-image', dataUrl)
    }
  }
}

export type SystemBridge = ReturnType<typeof createSystemBridge>
