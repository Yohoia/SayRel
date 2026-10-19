import { screen, type BrowserWindow } from 'electron'
import { WINDOWS, type WindowRoute } from '../../shared/constants'
import { BaseWindow } from './base'
import { createLogger } from '../lib/logger'

const log = createLogger('floating-bar')

/** Collapsed/expanded window geometry, matching the reference build. */
export const BAR_WIDTH = 750
export const BAR_HEIGHT = 500
const COLLAPSED_SIZE = 1

type Rect = { left: number; right: number; top: number; bottom: number }

/**
 * A transparent, click-through overlay pinned to the bottom of whichever
 * display the pointer is on.
 *
 * Clicks pass through by default; the renderer reports the screen-space rects
 * of its interactive elements and `updateElementPositions` flips
 * `setIgnoreMouseEvents` accordingly. The window is never focusable so it can
 * appear without stealing the caret from the target app.
 */
export class FloatingBarWindow extends BaseWindow {
  private mouseTracker: NodeJS.Timeout | null = null
  private mouseDetector: NodeJS.Timeout | null = null
  private currentDisplayId: number | null = null
  private elementPositions: Rect[] = []
  private lastMouseInside: boolean | null = null
  private expanded = true

  getWindowRoute(): WindowRoute {
    return WINDOWS.FLOATING_BAR
  }

  getWindowTitle(): string {
    return 'Status'
  }

  protected shouldShowOnReady(): boolean {
    return false
  }

  getWindowOptions() {
    const area = screen.getPrimaryDisplay().workArea
    return {
      x: area.x,
      y: area.y,
      type: 'panel' as const,
      width: BAR_WIDTH,
      height: BAR_HEIGHT,
      transparent: true,
      frame: false,
      hasShadow: false,
      maximizable: false,
      resizable: false,
      minimizable: false,
      focusable: false,
      fullscreen: false,
      skipTaskbar: true,
      backgroundColor: '#00000000'
    }
  }

  createWindow(): BrowserWindow | null {
    const wasEmpty = this.getWindow() === null
    const win = super.createWindow()
    if (!win) return null
    if (wasEmpty) {
      this.expanded = true
      win.once('closed', () => { this.stopMouseTracking(); this.stopMouseDetection() })
    }

    win.setIgnoreMouseEvents(true, { forward: false })
    win.setHiddenInMissionControl(true)
    // `screen-saver` keeps the overlay above full-screen apps and Stage Manager.
    win.setAlwaysOnTop(true, 'screen-saver', 1)
    win.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true
    })
    win.setFullScreenable(false)
    win.showInactive()

    this.setupMouseTracking()
    this.startMouseDetection()
    return win
  }

  show(): void {
    const win = this.getWindow() ?? this.createWindow()
    win?.showInactive()
  }

  setExpanded(expanded: boolean): void {
    if (this.expanded === expanded) return
    this.expanded = expanded
    if (expanded) this.elementPositions = []
    const display = this.currentDisplay()
    if (display) this.moveWindowToDisplay(display.id)
  }

  private currentDisplay() {
    if (this.currentDisplayId == null) return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    return screen.getAllDisplays().find((d) => d.id === this.currentDisplayId) ?? screen.getPrimaryDisplay()
  }

  private setupMouseTracking(): void {
    this.stopMouseTracking()
    const point = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(point)
    this.currentDisplayId = display.id
    this.moveWindowToDisplay(display.id)

    this.mouseTracker = setInterval(() => {
      const next = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      if (next.id !== this.currentDisplayId) {
        this.currentDisplayId = next.id
        this.moveWindowToDisplay(next.id)
      }
    }, 100)
  }

  private moveWindowToDisplay(displayId: number): void {
    const win = this.getWindow()
    if (!win) return
    const display = screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay()
    const { x, y, width, height } = display.workArea
    const centerX = Math.floor(x + (width - BAR_WIDTH) / 2)
    const bottomY = Math.floor(y + height - BAR_HEIGHT)

    try {
      if (!this.expanded) {
        win.setBounds({ x, y, width: COLLAPSED_SIZE, height: COLLAPSED_SIZE })
      } else {
        win.setBounds({ x: centerX, y: bottomY, width: BAR_WIDTH, height: BAR_HEIGHT })
      }
    } catch (err) {
      log.warn('setBounds failed, forcing expanded', err)
      this.expanded = true
      win.setBounds({ x: centerX, y: bottomY, width: BAR_WIDTH, height: BAR_HEIGHT })
    }
  }

  private startMouseDetection(): void {
    this.stopMouseDetection()
    this.mouseDetector = setInterval(() => {
      const win = this.getWindow()
      if (!win) return
      if (!this.expanded || this.elementPositions.length === 0) {
        win.setIgnoreMouseEvents(true, { forward: false })
        this.lastMouseInside = false
        return
      }
      const cursor = screen.getCursorScreenPoint()
      const inside = this.elementPositions.some(
        (r) => cursor.x >= r.left && cursor.x <= r.right && cursor.y >= r.top && cursor.y <= r.bottom
      )
      if (inside !== this.lastMouseInside) {
        this.lastMouseInside = inside
        win.setIgnoreMouseEvents(!inside, { forward: !inside })
      }
    }, 40)
  }

  private stopMouseTracking(): void {
    if (this.mouseTracker) clearInterval(this.mouseTracker)
    this.mouseTracker = null
  }

  private stopMouseDetection(): void {
    if (this.mouseDetector) clearInterval(this.mouseDetector)
    this.mouseDetector = null
  }

  updateElementPositions(rects: Rect[]): void {
    this.elementPositions = Array.isArray(rects) ? rects.filter((rect) =>
      rect && [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) &&
      rect.right >= rect.left && rect.bottom >= rect.top
    ) : []
  }

  closeWindow(): void {
    this.stopMouseTracking()
    this.stopMouseDetection()
    super.closeWindow()
  }
}

export const floatingBar = new FloatingBarWindow()
