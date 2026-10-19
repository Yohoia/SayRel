import { BrowserWindow, screen } from 'electron'
import { WINDOWS, type WindowRoute } from '../../shared/constants'
import { BaseWindow } from './base'
import { hubWindow, type HubMode } from './hub'
import { floatingBar, BAR_HEIGHT, BAR_WIDTH } from './floatingBar'
import {
  interactiveCardWindow,
  loginWindow,
  onboardingWindow,
  sidebarWindow
} from './secondary'

export {
  hubWindow,
  floatingBar,
  sidebarWindow,
  onboardingWindow,
  loginWindow,
  interactiveCardWindow
}

export const windows = {
  hubWindow,
  floatingBar,
  sidebarWindow,
  onboardingWindow,
  loginWindow,
  interactiveCardWindow
}

export function allBaseWindows(): BaseWindow[] {
  return Object.values(windows)
}

export function windowForRoute(route: WindowRoute): BaseWindow | null {
  switch (route) {
    case WINDOWS.HUB:
      return hubWindow
    case WINDOWS.FLOATING_BAR:
      return floatingBar
    case WINDOWS.SIDEBAR:
      return sidebarWindow
    case WINDOWS.ONBOARDING:
      return onboardingWindow
    case WINDOWS.LOGIN:
      return loginWindow
    case WINDOWS.INTERACTIVE_CARD:
      return interactiveCardWindow
    default:
      return null
  }
}

export function openHub(mode: HubMode = 'main'): void {
  hubWindow.setMode(mode)
  hubWindow.createWindow()
  hubWindow.show()
}

export function closeAllWindows(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.close()
  }
}

/** Broadcast a channel to every live renderer. */
export function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  }
}

/** Screen-space rect of the floating bar, used to place the result card. */
export function floatingBarRect(): { x: number; y: number; width: number; height: number } {
  const win = floatingBar.getWindow()
  if (win) return win.getBounds()
  const area = screen.getPrimaryDisplay().workArea
  return {
    x: Math.round(area.x + (area.width - BAR_WIDTH) / 2),
    y: Math.round(area.y + area.height - BAR_HEIGHT),
    width: BAR_WIDTH,
    height: BAR_HEIGHT
  }
}

export type { HubMode }
