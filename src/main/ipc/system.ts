import { app, clipboard, dialog, nativeImage, shell, systemPreferences } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { hostname, release, type } from 'node:os'
import { settings } from '../lib/settings'
import { paths } from '../lib/paths'
import { util, input, keyboard } from '../lib/native'
import { getAppearanceState, setPreference } from '../services/appearance'
import {
  getLanguage,
  normalizeLocale,
  resetToSystemLanguage,
  setLanguage
} from '../services/i18n'
import { parseDictionaryCsv } from '../services/dictionary'
import { sidecar } from '../lib/sidecar'
import { captureAudioContext } from '../services/contextCapture'
import { createLogger } from '../lib/logger'
import { refreshShortcutRegistrations } from '../services/shortcutRegistration'
import { broadcast } from '../windows'
import type { Handler } from './index'

const log = createLogger('ipc:system')

export function registerSystemHandlers(handle: (c: string, f: Handler) => void): void {
  // The diagnostic sidebar requests a snapshot when the user refreshes it.
  handle('context:get-audio-context', () => captureAudioContext())

  // ---- appearance --------------------------------------------------------
  handle('appearance:get-color-mode', () => getAppearanceState().colorMode)
  handle('appearance:get-state', (_e, userId?: string) => getAppearanceState(userId))
  handle('appearance:set-preference', (_e, mode: any, userId?: string) =>
    setPreference(mode, userId)
  )

  // ---- settings ----------------------------------------------------------
  handle('store:use', (_e, action: string, payload?: any) => {
    if (action === 'get') return settings.get()
    if (action === 'patch') {
      const next = settings.patch(payload ?? {})
      applySideEffects(next)
      return next
    }
    if (action === 'reset') {
      const next = settings.reset()
      applySideEffects(next)
      return next
    }
    throw new Error(`unknown store action: ${action}`)
  })

  // ---- i18n --------------------------------------------------------------
  handle('i18n:get-language', () => getLanguage())
  handle('i18n:set-language', (_e, locale: string) => setLanguage(locale))
  handle('i18n:reset-to-system-language', () => resetToSystemLanguage())

  // ---- device ------------------------------------------------------------
  handle('device:get-info', () => ({
    deviceId: settings.deviceId,
    platform: process.platform,
    arch: process.arch,
    osVersion: `${type()} ${release()}`,
    appVersion: app.getVersion(),
    model: hostname(),
    locale: app.getLocale()
  }))

  handle('device:is-lid-open', () => {
    if (!util.deviceIsLidOpen) return true
    return util.deviceIsLidOpen() === 1
  })

  // ---- clipboard ---------------------------------------------------------
  handle('clipboard:write-text', (_e, text: string) => {
    clipboard.writeText(String(text ?? ''))
    return true
  })
  handle('clipboard:write-image', (_e, dataUrl: string) => {
    const image = nativeImage.createFromDataURL(dataUrl)
    if (image.isEmpty()) return false
    clipboard.writeImage(image)
    return true
  })

  // ---- context -----------------------------------------------------------
  handle('context:get-app-icon', async (_e, bundleId: string) => {
    try {
      const icon = await app.getFileIcon(applicationPathFor(bundleId), { size: 'large' })
      return icon.isEmpty() ? null : icon.toDataURL()
    } catch (err) {
      log.warn('icon lookup failed', err)
      return null
    }
  })

  // ---- files -------------------------------------------------------------
  handle('file:open-log', async () => {
    await shell.openPath(paths.logs)
    return true
  })
  handle('file:clear-log', async () => {
    try {
      writeFileSync(join(paths.logs, 'main.log'), '')
    } catch {
      /* ignore */
    }
    return true
  })

  handle('file:pick-and-parse-dictionary-csv', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }]
    })
    if (result.canceled || !result.filePaths[0]) return { canceled: true, entries: [] }
    const content = readFileSync(result.filePaths[0], 'utf8')
    return { canceled: false, fileName: basename(result.filePaths[0]), entries: parseDictionaryCsv(content) }
  })

  handle('file:save-audio-with-dialog', async (_e, payload: any) => {
    const result = await dialog.showSaveDialog({
      defaultPath: join(app.getPath('downloads'), payload?.name ?? 'recording.ogg'),
      filters: [{ name: 'Ogg Opus', extensions: ['ogg'] }]
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    const data = Buffer.from(new Uint8Array(payload?.data ?? []))
    writeFileSync(result.filePath, data)
    return { canceled: false, path: result.filePath }
  })

  handle('file:save-png-with-dialog', async (_e, dataUrl: string, name?: string) => {
    const image = nativeImage.createFromDataURL(dataUrl)
    const result = await dialog.showSaveDialog({
      defaultPath: join(app.getPath('downloads'), name ?? 'offkey.png'),
      filters: [{ name: 'PNG', extensions: ['png'] }]
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    writeFileSync(result.filePath, image.toPNG())
    return { canceled: false, path: result.filePath }
  })

  handle('file:save-recording-log', async (_e, payload: any) => {
    const file = join(paths.recordingsLogs, `${payload?.sessionId ?? 'session'}.json`)
    writeFileSync(file, JSON.stringify(payload, null, 2))
    return file
  })

  // ---- permissions -------------------------------------------------------
  handle('permission:check-with-child-process', async (_e, kind: string) => {
    const granted = await checkPermission(kind)
    if (kind === 'accessibility' && granted && !keyboard.running) {
      keyboard.start()
      refreshShortcutRegistrations()
    }
    return granted
  })
  handle('permission:request', async (_e, kind: string) => requestPermission(kind))
  handle('permission:diagnose-microphone', async () => {
    const status = systemPreferences.getMediaAccessStatus('microphone')
    return {
      status,
      devices: (await import('../services/audioDevices')).listAudioDevices(true)
    }
  })
  handle('permission:reset-accessibility', async () => {
    // macOS caches the grant per bundle id; the user must remove it manually.
    if (process.platform === 'darwin') {
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
      )
    }
    return true
  })
  handle('permission:update-auto-launch', (_e, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) })
    settings.patch({ launchAtLogin: Boolean(enabled) })
    return true
  })
  handle('permission:update-show-app-in-dock', (_e, show: boolean) => {
    if (process.platform === 'darwin' && app.dock) {
      if (show) app.dock.show()
      else app.dock.hide()
    }
    settings.patch({ showInDock: Boolean(show) })
    return true
  })

  // ---- troubleshooting ---------------------------------------------------
  handle('troubleshooting:get-system-info', () => ({
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    osVersion: `${type()} ${release()}`,
    locale: app.getLocale(),
    deviceId: settings.deviceId,
    logsPath: paths.logs,
    dbPath: paths.db,
    recordingsPath: paths.recordings
  }))

  handle('rsa:get-config', () => sidecar.rsa.getConfig())
  handle('rsa:set-config', (_e, config: unknown) => sidecar.rsa.setConfig(config))
  handle('rsa:is-enabled', () => sidecar.rsa.isEnabled())
  handle('rsa:encrypt', (_e, value: string) => sidecar.rsa.encrypt(String(value)))
  handle('rsa:clear', () => sidecar.rsa.clear())
}

function applySideEffects(next: ReturnType<typeof settings.get>): void {
  broadcast('store:changed', next)
  refreshShortcutRegistrations()
  app.setLoginItemSettings({ openAtLogin: next.launchAtLogin })
  if (process.platform === 'darwin' && app.dock) {
    next.showInDock ? app.dock.show() : app.dock.hide()
  }
}

function applicationPathFor(bundleId: string): string {
  // Validate bundleId to prevent command injection
  if (!/^[a-zA-Z0-9.-]+$/.test(bundleId)) {
    log.error(`Invalid bundle ID format: ${bundleId}`)
    return '/Applications'
  }

  try {
    // Use spawnSync with array arguments to prevent injection
    const { spawnSync } = require('node:child_process')
    const result = spawnSync('mdfind', [
      `kMDItemCFBundleIdentifier == '${bundleId}'`
    ], {
      encoding: 'utf8',
      timeout: 5000, // 5 second timeout
      maxBuffer: 1024 * 1024 // 1MB max output
    })

    if (result.status === 0 && result.stdout) {
      const output = result.stdout.split('\n')[0].trim()
      if (output) return output
    }
  } catch (err) {
    log.error(`Failed to find application path for ${bundleId}`, err)
  }
  return '/Applications'
}

async function checkPermission(kind: string): Promise<boolean> {
  switch (kind) {
    case 'microphone':
      return systemPreferences.getMediaAccessStatus('microphone') === 'granted'
    case 'screenRecording':
      return systemPreferences.getMediaAccessStatus('screen') === 'granted'
    case 'accessibility':
      return (util.checkAccessibilityPermission?.(0) ?? input.checkAccessibilityPermission?.(0) ?? 0) === 1
    default:
      return false
  }
}

async function requestPermission(kind: string): Promise<boolean> {
  switch (kind) {
    case 'microphone':
      return systemPreferences.askForMediaAccess('microphone')
    case 'accessibility':
      return (util.checkAccessibilityPermission?.(1) ?? 0) === 1
    case 'screenRecording':
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
      )
      return systemPreferences.getMediaAccessStatus('screen') === 'granted'
    default:
      return false
  }
}

/** Stable hash helper used by diagnostics and telemetry redaction. */
export function hashDeviceId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

void normalizeLocale
void settings
