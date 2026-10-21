/**
 * Type-safe IPC channel definitions.
 *
 * This file defines the request/response types for all IPC channels,
 * providing compile-time type safety across the IPC boundary.
 */

import type {
  AudioDeviceInfo,
  MicDeviceInfo,
  FocusedAppInfo,
  FocusedInputInfo,
  HistoryRecord,
  DictionaryEntry,
  UpdaterState
} from './types'
import type { Settings } from './settings'
import type { Mode } from './constants'

/**
 * Central registry of all IPC channels with their request/response types.
 *
 * Usage:
 * - Main process: Use TypedHandler<C> for type-safe handlers
 * - Preload: Use this to generate type-safe bridge methods
 * - Renderer: Import Bridge type that derives from this
 */
export interface IpcChannels {
  // Audio
  'audio:get-devices-async': {
    request: void
    response: AudioDeviceInfo[]
  }
  'audio:is-muted': {
    request: void
    response: boolean
  }
  'audio:mute': {
    request: void
    response: boolean
  }
  'audio:unmute': {
    request: void
    response: boolean
  }

  // Context
  'context:capture-snapshot': {
    request: void
    response: {
      focusedApp: FocusedAppInfo | null
      focusedInput: FocusedInputInfo | null
      visibleText: string | null
    }
  }
  'context:get-app-icon': {
    request: { bundleId: string }
    response: string | null
  }

  // History
  'history:query': {
    request: {
      mode?: Mode
      limit?: number
      offset?: number
    }
    response: HistoryRecord[]
  }
  'history:delete': {
    request: { id: string }
    response: boolean
  }

  // Settings
  'settings:get': {
    request: void
    response: Settings
  }
  'settings:patch': {
    request: Partial<Settings>
    response: Settings
  }
  'settings:reset': {
    request: void
    response: Settings
  }

  // Dictionary
  'dictionary:get-all': {
    request: void
    response: DictionaryEntry[]
  }
  'dictionary:add': {
    request: { word: string }
    response: DictionaryEntry
  }
  'dictionary:delete': {
    request: { id: string }
    response: boolean
  }

  // System
  'troubleshooting:get-system-info': {
    request: void
    response: {
      version: string
      platform: string
      arch: string
      logsPath: string
      dbPath: string
      recordingsPath: string
    }
  }

  // RSA
  'rsa:get-config': {
    request: void
    response: { enabled: boolean; publicKey: string | null }
  }
  'rsa:set-config': {
    request: { enabled?: boolean; publicKey?: string | null }
    response: { enabled: boolean; publicKey: string | null }
  }
  'rsa:encrypt': {
    request: { value: string }
    response: string
  }

  // Updater
  'updater:check-for-update': {
    request: void
    response: UpdaterState
  }
  'updater:download-update': {
    request: void
    response: void
  }
  'updater:quit-and-install': {
    request: void
    response: void
  }
}

/**
 * Type-safe IPC handler signature.
 *
 * Usage in main process:
 * ```typescript
 * const handler: TypedHandler<'audio:is-muted'> = async (event) => {
 *   return false
 * }
 * ```
 */
export type TypedHandler<C extends keyof IpcChannels> = (
  event: Electron.IpcMainInvokeEvent,
  ...args: IpcChannels[C]['request'] extends void
    ? []
    : [IpcChannels[C]['request']]
) => Promise<IpcChannels[C]['response']> | IpcChannels[C]['response']

/**
 * Extract request type for a channel
 */
export type IpcRequest<C extends keyof IpcChannels> = IpcChannels[C]['request']

/**
 * Extract response type for a channel
 */
export type IpcResponse<C extends keyof IpcChannels> = IpcChannels[C]['response']
