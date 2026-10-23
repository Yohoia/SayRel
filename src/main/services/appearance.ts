import { nativeTheme, systemPreferences } from 'electron'
import { settings } from '../lib/settings'
import { broadcast } from '../windows'
import { IPC } from '../../shared/ipc'
import type { AppearanceState } from '../../shared/types'
import type { ColorMode } from '../../shared/settings'
import { createLogger } from '../lib/logger'

const log = createLogger('appearance')

export function getColorMode(): 'light' | 'dark' | 'system' {
  return settings.get().appearancePreference
}

export function getAppearanceState(): AppearanceState {
  return {
    colorMode: getColorMode(),
    resolved: nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }
}

export function applyTheme(mode: ColorMode): void {
  nativeTheme.themeSource = mode
}

export function watchSystemTheme(): void {
  nativeTheme.on('updated', () => {
    broadcast(IPC.APPEARANCE_COLOR_MODE_CHANGED, getAppearanceState())
  })
  if (process.platform === 'darwin') {
    try {
      systemPreferences.subscribeNotification('AppleInterfaceThemeChangedNotification', () => {
        log.debug('system theme changed')
        broadcast(IPC.APPEARANCE_COLOR_MODE_CHANGED, getAppearanceState())
      })
    } catch {
      /* older macOS */
    }
  }
}
