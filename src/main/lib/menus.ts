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
              { role: 'about' as const, label: `关于 ${PRODUCT.displayName}` },
              { type: 'separator' as const },
              {
                label: '设置…',
                accelerator: 'CmdOrCtrl+,',
                click: () => openSettings()
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const, accelerator: 'CmdOrCtrl+Q' }
            ]
          }
        ]
      : []),
    {
      label: '文件',
      submenu: [
        { label: '首页', click: () => openHub('main') },
        { label: '历史记录', click: () => openHub('main') },
        { type: 'separator' },
        { label: '打开录音文件夹', click: () => void openRecordings() },
        ...(isMac ? [] : [{ role: 'quit' as const }])
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: '显示',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: '窗口',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
    }
  ]
  return Menu.buildFromTemplate(template)
}

export function buildTrayMenu(): Menu {
  const config = settings.get()
  return Menu.buildFromTemplate([
    { label: '打开首页', click: () => openHub('main') },
    { label: '查看历史记录', click: () => openHub('main') },
    { type: 'separator' },
    { label: '设置…', click: () => openSettings() },
    {
      label: '选择麦克风',
      submenu: [{ label: config.micDevice ?? '自动检测', enabled: false }]
    },
    { type: 'separator' },
    {
      label: `版本 ${app.getVersion()}`,
      enabled: false
    },
    { type: 'separator' },
    { label: `退出 ${PRODUCT.displayName}`, click: () => app.quit() }
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
