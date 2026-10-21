import { app, BrowserWindow, globalShortcut, Menu, protocol, session, Tray, nativeImage, Notification } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PRODUCT, WINDOWS } from '../shared/constants'
import { IPC } from '../shared/ipc'
import { createLogger } from './lib/logger'
import { paths } from './lib/paths'
import { settings } from './lib/settings'
import { closeDb, getDb } from './db'
import { setPreloadPath } from './windows/base'
import { allBaseWindows, broadcast, hubWindow, openHub, windows } from './windows'
import { registerIpc } from './ipc'
import { wireUpdater } from './ipc/updater'
import { applyTheme, watchSystemTheme } from './services/appearance'
import { getLanguage } from './services/i18n'
import { keyboard, nativeStatus } from './lib/native'
import { recordingMachine } from './services/recordingMachine'
import { buildTrayMenu, buildApplicationMenu } from './lib/menus'
import { handleKeyEvent } from './services/hotkeys'
import { refreshShortcutRegistrations } from './services/shortcutRegistration'
import { startCleanupSchedule } from './services/cleanup'
import { migrateFromV1 } from './services/history'
import { workerThreads } from './lib/workers'

const log = createLogger('main')

let tray: Tray | null = null
let quitting = false

// Single instance: the second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    openHub('main')
  })
}

protocol.registerSchemesAsPrivileged([
  { scheme: PRODUCT.urlScheme, privileges: { standard: true, secure: true } }
])

function configureSession(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = new Set(['microphone', 'media', 'clipboard-read', 'clipboard-sanitized-write'])
    callback(allowed.has(permission))
  })
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media')
}

function setupTray(): void {
  const isMac = process.platform === 'darwin'
  const filename = isMac ? 'tray.png' : process.platform === 'win32' ? 'tray-win32.png' : 'tray-linux.png'
  const icon = nativeImage.createFromPath(
    join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), 'build', filename)
  )
  if (isMac) icon.setTemplateImage(true)
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip(PRODUCT.displayName)
  tray.setContextMenu(buildTrayMenu())
  tray.on('click', () => openHub('main'))
}

async function bootstrap(): Promise<void> {
  if (process.platform === 'darwin') {
    app.dock?.setIcon(join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), 'build', 'mac-icon.png'))
  }
  getDb()
  migrateFromV1()

  configureSession()
  applyTheme(settings.get().appearancePreference)
  watchSystemTheme()

  setPreloadPath(join(__dirname, '../preload/index.cjs'))
  registerIpc()
  wireUpdater()

  Menu.setApplicationMenu(buildApplicationMenu())
  setupTray()
  refreshShortcutRegistrations()

  keyboard.onKey(handleKeyEvent)
  const started = keyboard.start()
  if (started !== 0) log.warn(`keyboard monitor unavailable (code ${started})`)
  refreshShortcutRegistrations()

  startCleanupSchedule()
  await getLanguage()

  if (!settings.get().onboardingCompleted) {
    windows.onboardingWindow.createWindow()
    windows.onboardingWindow.show()
  } else {
    openHub('main')
  }
  windows.floatingBar.createWindow()

  log.info(`offkey ready (native: ${JSON.stringify(nativeStatus)})`)
}

app.whenReady().then(bootstrap).catch((err) => {
  log.error('bootstrap failed', {
    message: err?.message,
    code: err?.code,
    sql: err?.sql,
    stack: err?.stack?.split('\n').slice(0, 12)
  })
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) openHub('main')
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  log.info('shutting down')
  globalShortcut.unregisterAll()
  keyboard.stop()
  await workerThreads.shutdown()
  closeDb()
  app.exit(0)
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

function handleDeepLink(raw: string): void {
  try {
    const url = new URL(raw)
    if (url.protocol !== `${PRODUCT.urlScheme}:`) return
    const route = url.searchParams.get('route')
    if (route) openHub('main')
  } catch (err) {
    log.warn('bad deep link', err)
  }
}

export { handleDeepLink, broadcast, allBaseWindows }
void IPC
void pathToFileURL
void Notification
void recordingMachine
void WINDOWS
void paths
