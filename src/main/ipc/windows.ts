import { app, BrowserWindow, screen, shell } from 'electron'
import {
  broadcast,
  hubWindow,
  interactiveCardWindow,
  onboardingWindow,
  openHub,
  sidebarWindow,
  windowForRoute,
  windows
} from '../windows'
import { WINDOWS } from '../../shared/constants'
import { recordingMachine } from '../services/recordingMachine'
import { settings } from '../lib/settings'
import { patchSettings } from '../services/settingsEffects'
import { util } from '../lib/native'
import { createLogger } from '../lib/logger'
import type { Handler } from './index'

const log = createLogger('ipc:windows')

export function registerWindowHandlers(handle: (c: string, f: Handler) => void): void {
  handle('page:open-hub', (_e, route?: string) => {
    if (route) hubWindow.setRoute(route)
    openHub('main')
    return true
  })

  handle('page:open-sidebar', () => {
    sidebarWindow.createWindow()
    sidebarWindow.show()
    return true
  })

  handle('page:close-sidebar', () => {
    sidebarWindow.closeWindow()
    return true
  })

  handle('page:open-typeless-bar', () => {
    windows.floatingBar.createWindow()
    return true
  })

  handle('page:restart-typeless-bar', () => {
    windows.floatingBar.closeWindow()
    windows.floatingBar.createWindow()
    return true
  })

  handle('page:open-interactive-card', (_e, payload?: unknown) => {
    interactiveCardWindow.setPayload(payload ?? null)
    interactiveCardWindow.setAnchor(interactiveCardWindow.computeInitialBounds())
    interactiveCardWindow.createWindow()
    interactiveCardWindow.show()
    return true
  })

  handle('page:close-interactive-card', () => {
    interactiveCardWindow.closeWindow()
    return true
  })

  handle('page:get-interactive-card-payload', () => interactiveCardWindow.getPayload())

  handle('page:update-interactive-card-bounds', (_e, bounds: any) => {
    if (bounds) interactiveCardWindow.updateBounds(bounds)
    return true
  })

  handle('page:change-hub-route', (_e, route: string) => {
    hubWindow.setRoute(route)
    broadcast('page:hub-route-changed', route)
    return true
  })

  handle('page:open-settings-modal', (_e, section?: string) => {
    openHub('main')
    hubWindow.send('page:open-settings-modal', section ?? null)
    return true
  })

  handle('page:open-entry-window', () => {
    if (!settings.get().onboardingCompleted) {
      onboardingWindow.createWindow()
      onboardingWindow.show()
    } else if (!settings.get().language) {
      openHub('main')
    } else {
      openHub('main')
    }
    return true
  })

  handle('page:open-onboarding', () => {
    onboardingWindow.createWindow()
    onboardingWindow.show()
    return true
  })

  handle('page:complete-onboarding', async () => {
    await patchSettings({ onboardingCompleted: true })
    onboardingWindow.closeWindow()
    openHub('main')
    return true
  })

  handle('page:is-onboarding-window-visible', () => onboardingWindow.isVisible())

  handle('page:floating-bar-set-expanded', (_e, expanded: boolean) => {
    windows.floatingBar.setExpanded(Boolean(expanded))
    return true
  })

  handle('page:floating-bar-update-positions', (_e, rects: unknown) => {
    windows.floatingBar.updateElementPositions((rects ?? []) as any)
    return true
  })

  handle('page:floating-bar-set-always-on-top-for-windows', () => true)

  handle('page:floating-bar-click', async (_e, action: string, payload?: unknown) => {
    switch (action) {
      case 'translation-language': {
        if (typeof payload !== 'string' || !recordingMachine.selectTranslationLanguage(payload)) return false
        await patchSettings({ translationTargetLanguage: payload })
        return true
      }
      case 'start':
        await recordingMachine.start()
        recordingMachine.setHandsFree(true)
        return true
      case 'finish':
        await recordingMachine.dispatch({ type: 'FINISH' })
        return true
      case 'cancel':
        recordingMachine.dispatch({ type: 'CANCEL' })
        return true
      case 'retry':
        await recordingMachine.dispatch({ type: 'RETRY' })
        return true
      case 'hover':
        return true
      default:
        return false
    }
  })

  handle('page:open-url', async (_e, url: string) => {
    if (!/^https?:\/\//.test(url)) return false
    await shell.openExternal(url)
    return true
  })

  handle('page:open-url-scheme', async (_e, url: string) => {
    await shell.openExternal(url)
    return true
  })

  handle('page:launch-application', (_e, name: string) => {
    if (util.launchApplicationByName) return util.launchApplicationByName(name) === 0
    return false
  })

  handle('page:open-devtools', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.openDevTools({ mode: 'detach' })
    return true
  })

  handle('page:close-all-devtools', () => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.closeDevTools()
    return true
  })

  handle('page:set-hub-window-button-visibility', (_e, visible: boolean) => {
    const win = hubWindow.getWindow()
    if (!win) return false
    win.setWindowButtonVisibility(Boolean(visible))
    return true
  })

  handle('page:set-debug-window-position', (_e, route: string, x: number, y: number) => {
    const target = windowForRoute(route as any)
    const win = target?.getWindow()
    if (!win) return false
    win.setPosition(Math.round(x), Math.round(y))
    return true
  })

  handle('app:restart', () => {
    app.relaunch()
    app.exit(0)
    return true
  })

  // Keeps the route table addressable from main for deep links.
  handle('page:route-window', (_e, route: string) => {
    const target = windowForRoute(route as any)
    if (!target) return false
    target.createWindow()
    target.show()
    return true
  })

  log.debug('window handlers ready')
  void WINDOWS
}
