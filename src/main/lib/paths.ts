import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'

/**
 * All on-disk locations derive from Electron's `app.getPath`, so a packaged
 * build and a dev build never share mutable state.
 */
export const paths = {
  get userData(): string {
    return app.getPath('userData')
  },
  get logs(): string {
    const dir = join(app.getPath('logs'))
    mkdirSync(dir, { recursive: true })
    return dir
  },
  get db(): string {
    const current = join(this.userData, 'sayrel.db')
    const legacy = join(this.userData, 'offkey.db')
    return !existsSync(current) && existsSync(legacy) ? legacy : current
  },
  get recordings(): string {
    const dir = join(this.userData, 'recordings')
    mkdirSync(dir, { recursive: true })
    return dir
  },
  get recordingsLogs(): string {
    const dir = join(this.logs, 'recording_events')
    mkdirSync(dir, { recursive: true })
    return dir
  },
  get opusTemp(): string {
    const dir = join(app.getPath('temp'), 'sayrel_opus')
    mkdirSync(dir, { recursive: true })
    return dir
  },
  get helpers(): string {
    // In development the helpers live beside the sources; packaged builds
    // place them under Resources/lib.
    return app.isPackaged
      ? join(process.resourcesPath, 'lib')
      : join(app.getAppPath(), 'resources', 'lib')
  },
  get locales(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'locales')
      : join(app.getAppPath(), 'resources', 'locales')
  },
  join
}
