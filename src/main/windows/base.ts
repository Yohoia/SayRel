import { app, BrowserWindow, screen, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'
import type { WindowRoute } from '../../shared/constants'

export const WINDOW_CLOSED = 'page:window-closed'
export const WINDOW_CREATED = 'page:window-created'

let preloadPath: string | null = null

export function setPreloadPath(path: string): void {
  preloadPath = path
}

function resolvePreload(): string {
  return preloadPath ?? join(__dirname, '../preload/index.cjs')
}

/**
 * Every window is created from a page file in `out/renderer`. In development
 * the vite dev server owns the URL; packaged builds load from disk.
 */
function resolveUrl(route: WindowRoute): { url?: string; file?: string } {
  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (devServer) {
    return { url: `${devServer}/${route}` }
  }
  return { file: join(__dirname, '../renderer', route) }
}

export abstract class BaseWindow {
  protected window: BrowserWindow | null = null
  protected destroyed = false

  abstract getWindowRoute(): WindowRoute
  abstract getWindowTitle(): string
  abstract getWindowOptions(): BrowserWindowConstructorOptions

  getWindow(): BrowserWindow | null {
    if (this.window && !this.window.isDestroyed()) return this.window
    return null
  }

  createWindow(): BrowserWindow | null {
    const existing = this.getWindow()
    if (existing) {
      existing.show()
      return existing
    }
    const options: BrowserWindowConstructorOptions = {
      title: this.getWindowTitle(),
      icon: join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
      show: false,
      webPreferences: {
        preload: resolvePreload(),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true, // ✓ Enable sandbox for security
        spellcheck: false
      },
      ...this.getWindowOptions()
    }
    const win = new BrowserWindow(options)
    this.window = win
    this.destroyed = false

    const target = resolveUrl(this.getWindowRoute())
    if (target.url) {
      win.loadURL(target.url)
    } else if (target.file) {
      win.loadFile(target.file)
    }

    win.once('ready-to-show', () => {
      if (!win.isDestroyed() && this.shouldShowOnReady()) win.show()
    })
    win.on('closed', () => {
      this.window = null
      this.destroyed = true
      const { BrowserWindow: BW } = require('electron')
      for (const other of BW.getAllWindows()) {
        other.webContents.send(WINDOW_CLOSED, this.getWindowRoute())
      }
    })

    const { BrowserWindow: BW } = require('electron')
    for (const other of BW.getAllWindows()) {
      other.webContents.send(WINDOW_CREATED, this.getWindowRoute())
    }
    return win
  }

  protected shouldShowOnReady(): boolean {
    return true
  }

  closeWindow(): void {
    const win = this.getWindow()
    if (!win) return
    win.close()
    this.window = null
  }

  show(): void {
    const win = this.getWindow() ?? this.createWindow()
    win?.show()
    win?.focus()
  }

  hide(): void {
    this.getWindow()?.hide()
  }

  isVisible(): boolean {
    return this.getWindow()?.isVisible() ?? false
  }

  send(channel: string, ...args: unknown[]): void {
    const win = this.getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
  }

  /** Work area of the display a window should live on. */
  protected workAreaFor(win: BrowserWindow | null) {
    if (!win) return screen.getPrimaryDisplay().workArea
    return screen.getDisplayMatching(win.getBounds()).workArea
  }
}
