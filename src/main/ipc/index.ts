import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'
import { IPC_EXTRA } from '../../shared/ipc-extra'
import type { IpcChannels, TypedHandler } from '../../shared/ipc-types'
import { registerAudioHandlers } from './audio'
import { registerHistoryHandlers } from './history'
import { registerWindowHandlers } from './windows'
import { registerSystemHandlers } from './system'
import { registerUpdaterHandlers } from './updater'
import { registerMiscHandlers } from './misc'
import { registerProviderHandlers } from './providers'
import { createLogger } from '../lib/logger'

const log = createLogger('ipc')

/**
 * Legacy handler type - use TypedHandler<C> for new code
 * @deprecated Use TypedHandler from shared/ipc-types instead
 */
export type Handler = (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any

const registered = new Set<string>()

/**
 * Register a type-safe IPC handler.
 *
 * @example
 * registerHandler('audio:is-muted', async (event) => {
 *   return false
 * })
 */
export function registerHandler<C extends keyof IpcChannels>(
  channel: C,
  fn: TypedHandler<C>
): void {
  if (registered.has(channel)) {
    log.warn(`channel registered twice: ${channel}`)
    return
  }
  registered.add(channel)
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(event, ...args as any)
    } catch (err: any) {
      log.error(`${channel} failed`, err)
      throw err
    }
  })
}

/**
 * Legacy untyped handler registration - use registerHandler for new code
 * @deprecated Use registerHandler with TypedHandler instead
 */
function handle(channel: string, fn: Handler): void {
  if (registered.has(channel)) {
    log.warn(`channel registered twice: ${channel}`)
    return
  }
  registered.add(channel)
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(event, ...args)
    } catch (err: any) {
      log.error(`${channel} failed`, err)
      throw err
    }
  })
}

export function registerIpc(): void {
  registerAudioHandlers(handle)
  registerHistoryHandlers(handle)
  registerWindowHandlers(handle)
  registerSystemHandlers(handle)
  registerUpdaterHandlers(handle)
  registerMiscHandlers(handle)
  registerProviderHandlers(handle)
  log.info(`registered ${registered.size} invoke channels`)
}

export { handle, IPC, IPC_EXTRA, BrowserWindow }
