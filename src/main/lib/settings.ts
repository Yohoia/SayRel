import Store from 'electron-store'
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from '../../shared/settings'
import { createLogger } from './logger'

const log = createLogger('settings')

type Persisted = { settings: Settings; deviceId?: string }

const store = new Store<Persisted>({
  name: 'settings',
  defaults: { settings: DEFAULT_SETTINGS }
})

let cache: Settings | null = null

export const settings = {
  get(): Settings {
    if (!cache) {
      try {
        cache = mergeSettings(store.get('settings'))
      } catch (err) {
        log.error('failed to read settings, falling back to defaults', err)
        cache = { ...DEFAULT_SETTINGS }
      }
    }
    return cache
  },

  patch(partial: DeepPartial<Settings>): Settings {
    const next: Settings = {
      ...settings.get(),
      ...partial,
      shortcut: { ...settings.get().shortcut, ...(partial.shortcut ?? {}) },
      commandShortcut: { ...settings.get().commandShortcut, ...(partial.commandShortcut ?? {}) },
      askAnythingShortcut: {
        ...settings.get().askAnythingShortcut,
        ...(partial.askAnythingShortcut ?? {})
      },
      translationShortcut: { ...settings.get().translationShortcut, ...(partial.translationShortcut ?? {}) },
      provider: { ...settings.get().provider, ...(partial.provider ?? {}) }
    } as Settings
    Object.assign(next, mergeSettings(next))
    cache = next
    store.set('settings', next)
    return next
  },

  reset(): Settings {
    cache = { ...DEFAULT_SETTINGS }
    store.set('settings', cache)
    return cache
  },

  get deviceId(): string {
    let id = store.get('deviceId')
    if (!id) {
      id = crypto.randomUUID()
      store.set('deviceId', id)
    }
    return id
  }
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}
