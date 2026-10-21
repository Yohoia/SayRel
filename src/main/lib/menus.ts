import { app, Menu, shell, Tray, type MenuItemConstructorOptions } from 'electron'
import { PRODUCT } from '../../shared/constants'
import { openHub, windows } from '../windows'
import { settings } from './settings'
import { createLogger } from './logger'

const log = createLogger('menus')

export function buildApplicationMenu(): Menu {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: PRODUCT.displayName,
            submenu: [
              { role: 'about' as const, label: `About ${PRODUCT.displayName}` },
              { type: 'separator' as const },
              {
                label: "Settings…",
                accelerator: 'CmdOrCtrl+,',
                click: () => openSettings()
              },
              { type: 'separator' as const },
              { role: 'services' as const, label: 'Services' },
              { type: 'separator' as const },
              { role: 'hide' as const, label: 'Hide Sayrel' },
              { role: 'hideOthers' as const, label: 'Hide others' },
              { role: 'unhide' as const, label: 'Show all' },
              { type: 'separator' as const },
              { role: 'quit' as const, label: 'Quit Sayrel', accelerator: 'CmdOrCtrl+Q' }
            ]
          }
        ]
      : []),
    {
      label: "File",
      submenu: [
        { label: "Home", click: () => openHub('main') },
        { label: "History", click: () => openHub('main') },
        { type: 'separator' },
        { label: "Open recordings folder", click: () => void openRecordings() },
        ...(isMac ? [] : [{ role: 'quit' as const, label: 'Quit Sayrel' }])
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: 'undo', label: 'Undo' },
        { role: 'redo', label: 'Redo' },
        { type: 'separator' },
        { role: 'cut', label: 'Cut' },
        { role: 'copy', label: 'Copy' },
        { role: 'paste', label: 'Paste' },
        { role: 'selectAll', label: 'Select all' }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: 'reload', label: 'Reload' },
        { role: 'forceReload', label: 'Force reload' },
        { role: 'toggleDevTools', label: 'Toggle developer tools' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Actual size' },
        { role: 'zoomIn', label: 'Zoom in' },
        { role: 'zoomOut', label: 'Zoom out' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Toggle full screen' }
      ]
    },
    {
      label: "Window",
      submenu: [{ role: 'minimize', label: 'Minimize' }, { role: 'zoom', label: 'Zoom' }, { type: 'separator' }, { role: 'front', label: 'Bring all to front' }]
    }
  ]
  return Menu.buildFromTemplate(template)
}

export function buildTrayMenu(): Menu {
  const config = settings.get()
  return Menu.buildFromTemplate([
    { label: "Open home", click: () => openHub('main') },
    { label: "Show history", click: () => openHub('main') },
    { type: 'separator' },
    { label: "Settings…", click: () => openSettings() },
    {
      label: "Select microphone",
      submenu: [{ label: config.micDevice ?? "Auto-detect", enabled: false }]
    },
    { type: 'separator' },
    {
      label: `Version ${app.getVersion()}`,
      enabled: false
    },
    { type: 'separator' },
    { label: `Quit ${PRODUCT.displayName}`, click: () => app.quit() }
  ])
}

export function refreshTray(tray: Tray | null): void {
  if (!tray) return
  tray.setContextMenu(buildTrayMenu())
}

function openSettings(): void {
  openHub('main')
  windows.hubWindow.send('page:open-settings-modal', null)
}

async function openRecordings(): Promise<void> {
  const { paths } = await import('./paths')
  await shell.openPath(paths.recordings)
  log.debug('opened recordings folder')
}
