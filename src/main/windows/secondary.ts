import { screen, type BrowserWindow } from 'electron'
import { WINDOWS, type WindowRoute } from '../../shared/constants'
import { BaseWindow } from './base'

export class SidebarWindow extends BaseWindow {
  getWindowRoute(): WindowRoute {
    return WINDOWS.SIDEBAR
  }
  getWindowTitle(): string {
    return "Sayrel context"
  }
  getWindowOptions() {
    const area = screen.getPrimaryDisplay().workArea
    const width = 350
    const height = 500
    return {
      width,
      height,
      minWidth: 280,
      minHeight: 300,
      x: area.x + area.width - width,
      y: area.y + area.height - height,
      resizable: true,
      transparent: true,
      titleBarStyle: 'hidden' as const,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      hasShadow: true,
      skipTaskbar: true,
      backgroundColor: '#00000000'
    }
  }
}

export class OnboardingWindow extends BaseWindow {
  getWindowRoute(): WindowRoute {
    return WINDOWS.ONBOARDING
  }
  getWindowTitle(): string {
    return "Welcome to Sayrel"
  }
  getWindowOptions() {
    return {
      width: 1080,
      height: 750,
      minWidth: 988,
      minHeight: 685,
      resizable: true,
      transparent: true,
      vibrancy: 'sidebar' as const,
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: true,
      trafficLightPosition: { x: 20, y: 16 },
      backgroundColor: '#00000000'
    }
  }
}

export class InteractiveCardWindow extends BaseWindow {
  private payload: unknown = null
  private mouseTracker: NodeJS.Timeout | null = null
  private boundsTimer: NodeJS.Timeout | null = null
  private currentDisplayId: number | null = null
  private contentHeight: number | null = null
  private anchor: { x: number; y: number; width: number; height: number } | null = null

  getWindowRoute(): WindowRoute {
    return WINDOWS.INTERACTIVE_CARD
  }
  getWindowTitle(): string {
    return "AI answer"
  }
  getWindowOptions() {
    const bounds = this.anchor ?? this.computeInitialBounds()
    return {
      type: 'panel' as const,
      width: bounds.width,
      height: bounds.height,
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      transparent: true,
      frame: false,
      hasShadow: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      focusable: true,
      skipTaskbar: true,
      backgroundColor: '#00000000'
    }
  }

  createWindow(): BrowserWindow | null {
    const existing = this.getWindow()
    const win = super.createWindow()
    if (!win || existing) return win
    win.setHiddenInMissionControl(true)
    win.setAlwaysOnTop(true, 'screen-saver', 1)
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    win.setFullScreenable(false)
    this.currentDisplayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
    // Original card follows the pointer between displays, keeping its height.
    this.mouseTracker = setInterval(() => {
      if (win.isDestroyed()) return
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      if (display.id === this.currentDisplayId) return
      this.currentDisplayId = display.id
      win.setBounds(this.contentBounds(this.contentHeight ?? win.getBounds().height))
    }, 100)
    win.once('closed', () => this.clearTracking())
    return win
  }

  private clearTracking(): void {
    if (this.mouseTracker) clearInterval(this.mouseTracker)
    if (this.boundsTimer) clearTimeout(this.boundsTimer)
    this.mouseTracker = null
    this.boundsTimer = null
    this.currentDisplayId = null
  }

  closeWindow(): void {
    this.clearTracking()
    this.payload = null
    this.anchor = null
    this.contentHeight = null
    super.closeWindow()
  }

  setPayload(payload: unknown): void {
    this.payload = payload
    this.contentHeight = null
    if (this.boundsTimer) clearTimeout(this.boundsTimer)
    this.boundsTimer = null
    this.send('interactive-card:update', payload)
  }

  getPayload(): unknown {
    return this.payload
  }

  setAnchor(rect: { x: number; y: number; width: number; height: number }): void {
    this.anchor = rect
  }

  // Typeless main:12425–12553, 800px wide and 20px above the work-area bottom.
  private contentBounds(height: number) {
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    const width = 800
    const boundedHeight = Math.min(Math.max(Math.round(height), 1), Math.max(1, area.height - 20))
    return {
      x: Math.max(area.x, Math.min(area.x + Math.floor((area.width - width) / 2), area.x + area.width - width)),
      y: Math.max(area.y, area.y + area.height - 20 - boundedHeight),
      width,
      height: boundedHeight
    }
  }

  computeInitialBounds() {
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    const available = Math.max(1, area.height - 20)
    return this.contentBounds(available >= 800 ? 800 : Math.min(500, available))
  }

  updateBounds(rect: { height: number }): void {
    if (!Number.isFinite(rect.height) || rect.height <= 0) return
    this.contentHeight = Math.min(800, Math.round(rect.height))
    if (this.boundsTimer) clearTimeout(this.boundsTimer)
    this.boundsTimer = setTimeout(() => {
      this.boundsTimer = null
      const win = this.getWindow()
      if (!win || this.contentHeight === null) return
      const bounds = this.contentBounds(this.contentHeight)
      this.anchor = bounds
      const current = win.getBounds()
      if (Math.abs(current.height - bounds.height) > 2 || Math.abs(current.x - bounds.x) > 2 || Math.abs(current.y - bounds.y) > 2) win.setBounds(bounds)
    }, 80)
  }
}

export const sidebarWindow = new SidebarWindow()
export const onboardingWindow = new OnboardingWindow()
export const interactiveCardWindow = new InteractiveCardWindow()
