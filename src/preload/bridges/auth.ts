/**
 * Preload Bridge - Auth Domain
 *
 * Handles authentication-related IPC methods
 */

import type { IpcChannels } from '../../shared/ipc-types'

type Listener = (...args: unknown[]) => void

export function createAuthBridge(
  invoke: <C extends keyof IpcChannels>(
    channel: C,
    ...args: IpcChannels[C]['request'] extends void ? [] : [IpcChannels[C]['request']]
  ) => Promise<IpcChannels[C]['response']>,
  subscribe: (channel: string, listener: Listener) => () => void
) {
  return {
    getAccessToken: () => invoke('auth:get-access-token'),
    getCurrent: () => invoke('auth:get-current'),
    isLoggedIn: () => invoke('auth:is-logged-in'),
    login: () => invoke('auth:login'),
    logout: () => invoke('auth:logout'),
    startAppLogin: () => invoke('auth:start-app-login'),
    onLoginLoadingChanged: (cb: Listener) => subscribe('auth:app-login-loading-changed', cb),
    onLoginFailed: (cb: Listener) => subscribe('auth:app-login-failed', cb)
  }
}

export type AuthBridge = ReturnType<typeof createAuthBridge>
