/**
 * Preload Bridge - Settings Domain
 *
 * Handles application settings management
 */

type Listener = (...args: unknown[]) => void

export function createSettingsBridge(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
  subscribe: (channel: string, listener: Listener) => () => void
) {
  return {
    get: () => invoke('store:use', 'get'),
    patch: (partial: unknown) => invoke('store:use', 'patch', partial),
    reset: () => invoke('store:use', 'reset'),
    onChanged: (cb: Listener) => subscribe('store:changed', cb)
  }
}

export type SettingsBridge = ReturnType<typeof createSettingsBridge>
