import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'
import { IPC_EXTRA } from '../../shared/ipc-extra'
import { registerAudioHandlers } from './audio'
import { registerHistoryHandlers } from './history'
import { registerWindowHandlers } from './windows'
import { registerSystemHandlers } from './system'
import { registerAuthHandlers } from './auth'
import { registerUpdaterHandlers } from './updater'
import { registerSyncHandlers } from './sync'
import { registerMiscHandlers } from './misc'
import { createLogger } from '../lib/logger'

const log = createLogger('ipc')

export type Handler = (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any

const registered = new Set<string>()

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
  registerAuthHandlers(handle)
  registerUpdaterHandlers(handle)
  registerSyncHandlers(handle)
  registerMiscHandlers(handle)
  log.info(`registered ${registered.size} invoke channels`)
}

export { handle, IPC, IPC_EXTRA, BrowserWindow }
