import { app } from 'electron'
import { z } from 'zod'
import { settings, type DeepPartial } from '../lib/settings'
import { SETTINGS_EFFECT_ERRORS, type Settings } from '../../shared/settings'
import { IPC } from '../../shared/ipc'
import { broadcast } from '../windows'
import { applyTheme, getAppearanceState } from './appearance'
import { getLanguage, normalizeLocale } from './i18n'
import { refreshShortcutRegistrations } from './shortcutRegistration'
import { createLogger } from '../lib/logger'

const log = createLogger('settings-effects')

const preferences = z.object({
  language: z.string().nullable().optional(),
  appearancePreference: z.enum(['light', 'dark', 'system']).optional()
})

export async function patchSettings(partial: DeepPartial<Settings>): Promise<Settings> {
  const parsed = preferences.parse(partial)
  const next = settings.patch({
    ...partial,
    ...parsed,
    ...(typeof parsed.language === 'string' ? { language: normalizeLocale(parsed.language) } : {})
  })
  await applyEffects({ next, fields: Object.keys(partial) })
  return settings.get()
}

export async function resetSettings(): Promise<Settings> {
  const next = settings.reset()
  await applyEffects({ next, fields: Object.keys(next) })
  return settings.get()
}

async function applyEffects({ next, fields }: { next: Settings; fields: string[] }): Promise<void> {
  const failures: string[] = []
  async function apply({ effect, run }: {
    effect: keyof typeof SETTINGS_EFFECT_ERRORS
    run: () => void | Promise<void>
  }): Promise<void> {
    try { await run() }
    catch (error) {
      log.warn(`Saved settings but failed to apply ${effect}`, error)
      failures.push(SETTINGS_EFFECT_ERRORS[effect])
    }
  }
  if (fields.includes('language')) {
    await apply({ effect: 'language', run: async () => {
      const locale = await getLanguage()
      if (settings.get().language === next.language) broadcast(IPC.I18N_LANGUAGE_CHANGED, locale)
    } })
  }
  if (fields.includes('appearancePreference')) {
    await apply({ effect: 'appearance', run: () => {
      if (settings.get().appearancePreference !== next.appearancePreference) return
      applyTheme(next.appearancePreference)
      broadcast(IPC.APPEARANCE_COLOR_MODE_CHANGED, getAppearanceState())
    } })
  }
  // Other settings retain their existing effects until their callers are migrated.
  if (fields.some(field => field !== 'language' && field !== 'appearancePreference')) {
    await apply({ effect: 'shortcuts', run: refreshShortcutRegistrations })
    await apply({ effect: 'login', run: () => app.setLoginItemSettings({ openAtLogin: settings.get().launchAtLogin }) })
    await apply({ effect: 'dock', run: async () => {
      if (process.platform === 'darwin' && app.dock) {
        if (settings.get().showInDock) await app.dock.show()
        else app.dock.hide()
      }
    } })
  }
  broadcast('store:changed', settings.get())
  if (failures.length) throw new Error(failures.join('\n'))
}
