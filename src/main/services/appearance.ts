import { nativeTheme, systemPreferences } from 'electron'
import Store from 'electron-store'
import { settings } from '../lib/settings'
import { broadcast } from '../windows'
import { IPC } from '../../shared/ipc'
import type { AppearanceState } from '../../shared/types'
import type { ColorMode } from '../../shared/settings'
import { createLogger } from '../lib/logger'

const log = createLogger('appearance')

const prefStore = new Store<{ byUserId: Record<string, ColorMode> }>({
  name: 'appearance',
  defaults: { byUserId: {} }
})

export function getColorMode(): 'light' | 'dark' | 'system' {
  return settings.get().appearancePreference
}

export function getAppearanceState(userId?: string | null): AppearanceState {
  const byUserId = prefStore.get('byUserId')
  return {
    colorMode: getColorMode(),
    resolved: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
    preferenceByUserId: byUserId
  }
}

export function setPreference(mode: ColorMode, userId?: string | null): AppearanceState {
  settings.patch({ appearancePreference: mode })
  if (userId) {
    const byUserId = { ...prefStore.get('byUserId'), [userId]: mode }
    prefStore.set('byUserId', byUserId)
  }
  applyTheme(mode)
  const state = getAppearanceState(userId)
  broadcast(IPC.APPEARANCE_COLOR_MODE_CHANGED, state)
  return state
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
