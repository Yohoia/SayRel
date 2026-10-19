import updaterPkg from 'electron-updater'

const { autoUpdater } = updaterPkg as typeof import('electron-updater')
import { app, BrowserWindow } from 'electron'
import { broadcast } from '../windows'
import { IPC } from '../../shared/ipc'
import { settings } from '../lib/settings'
import { createLogger } from '../lib/logger'
import type { Handler } from './index'
import type { UpdaterState } from '../../shared/types'

const log = createLogger('updater')

let state: UpdaterState = { status: 'idle', version: null, progress: null, error: null }
let wired = false

function setState(patch: Partial<UpdaterState>): void {
  state = { ...state, ...patch }
  broadcast('updater:state', state)
}

export function wireUpdater(): void {
  if (wired) return
  wired = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    setState({ status: 'checking' })
    broadcast(IPC.UPDATER_CHECKING_FOR_UPDATE)
  })
  autoUpdater.on('update-available', (info) => {
    setState({ status: 'available', version: info.version })
    broadcast(IPC.UPDATER_UPDATE_AVAILABLE, info)
  })
  autoUpdater.on('update-not-available', (info) => {
    setState({ status: 'not-available', version: info.version })
    broadcast(IPC.UPDATER_UPDATE_NOT_AVAILABLE, info)
  })
  autoUpdater.on('download-progress', (progress) => {
    setState({ status: 'downloading', progress: progress.percent })
    broadcast(IPC.UPDATER_DOWNLOAD_PROGRESS, progress)
  })
  autoUpdater.on('update-downloaded', (info) => {
    setState({ status: 'downloaded', version: info.version, progress: 100 })
    broadcast(IPC.UPDATER_UPDATE_DOWNLOADED, info)
  })
  autoUpdater.on('error', (err) => {
    log.error('updater error', err)
    setState({ status: 'error', error: err.message })
    broadcast(IPC.UPDATER_UPDATE_ERROR, err.message)
  })
}

export function registerUpdaterHandlers(handle: (c: string, f: Handler) => void): void {
  wireUpdater()

  handle('updater:check-for-update', async () => {
    if (!app.isPackaged) return { skipped: 'dev-build' }
    const result = await autoUpdater.checkForUpdates()
    return { version: result?.updateInfo.version ?? null }
  })

  handle('updater:check-update-and-download-silently', async () => {
    if (!app.isPackaged || !settings.get().autoUpdate) return { skipped: 'disabled' }
    const result = await autoUpdater.checkForUpdates()
    if (!result) return { skipped: 'no-result' }
    if (result.updateInfo.version !== app.getVersion()) {
      await autoUpdater.downloadUpdate()
      return { downloading: true, version: result.updateInfo.version }
    }
    return { upToDate: true }
  })

  handle('updater:download-update', async () => {
    await autoUpdater.downloadUpdate()
    return true
  })

  handle('updater:quit-and-install', () => {
    setImmediate(() => autoUpdater.quitAndInstall())
    return true
  })

  handle('updater:show-downloaded-notify', () => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.flashFrame(true)
    }
    return true
  })
}
