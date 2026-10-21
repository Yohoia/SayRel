import { nativeTheme, screen } from 'electron'
import { WINDOWS, type WindowRoute } from '../../shared/constants'
import { BaseWindow } from './base'

export type HubMode = 'main' | 'sidebar'

/**
 * The main window: dashboard, history, dictionary and settings. The sidebar
 * variant is the same renderer mounted as a narrow, vibrancy-backed pane.
 */
export class HubWindow extends BaseWindow {
  private mode: HubMode = 'main'
  private route = '/dashboard'

  constructor() {
    super()
  }

  getWindowRoute(): WindowRoute {
    return WINDOWS.HUB
  }

  getWindowTitle(): string {
    return 'Sayrel'
  }

  setMode(mode: HubMode): void {
    this.mode = mode
  }

  getMode(): HubMode {
    return this.mode
  }

  setRoute(route: string): void {
    this.route = route
  }

  getRoute(): string {
    return this.route
  }

  getWindowOptions() {
    const sidebar = this.mode === 'sidebar'
    const area = screen.getPrimaryDisplay().workArea
    const width = sidebar ? 420 : 1080
    const height = sidebar ? 750 : 750
    return {
      width,
      height,
      minWidth: sidebar ? 360 : 988,
      minHeight: sidebar ? 480 : 685,
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + (area.height - height) / 2),
      resizable: true,
      hasShadow: true,
      transparent: sidebar,
      vibrancy: sidebar ? ('sidebar' as const) : undefined,
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: true,
      trafficLightPosition: { x: 26, y: 24 },
      backgroundColor: sidebar ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#242121' : '#FFFFFF'
    }
  }

  show(): void {
    super.show()
  }
}

export const hubWindow = new HubWindow()
