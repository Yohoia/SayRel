import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api, bridge } from '../utils/bridge'
import { DEFAULT_SETTINGS, SETTINGS_EFFECT_ERRORS, type Settings } from '../../../shared/settings'
import { toast } from '../components/Toast'

type Ctx = {
  settings: Settings
  locale: string
  loaded: boolean
  patch: (partial: Partial<Settings>) => Promise<void>
  reload: () => Promise<void>
}

const SettingsContext = createContext<Ctx>({
  settings: DEFAULT_SETTINGS,
  locale: 'en',
  loaded: false,
  patch: async () => undefined,
  reload: async () => undefined
})

export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)
  const [systemLanguage, setSystemLanguage] = useState('en')
  const snapshotVersion = useRef(0)
  const locale = settings.language ?? systemLanguage

  const reload = useCallback(async () => {
    const version = snapshotVersion.current
    try {
      const next = await api.settings.get()
      if (next && version === snapshotVersion.current) {
        snapshotVersion.current++
        setSettings({ ...DEFAULT_SETTINGS, ...next })
      }
    } finally {
      setLoaded(true)
    }
  }, [])

  const patch = useCallback(async (partial: Partial<Settings>) => {
    const version = snapshotVersion.current
    try {
      const next = await api.settings.patch(partial)
      if (next && version === snapshotVersion.current) {
        snapshotVersion.current++
        setSettings({ ...DEFAULT_SETTINGS, ...next })
      }
      toast.success("Saved")
    } catch (error) {
      const failures = error instanceof Error
        ? Object.values(SETTINGS_EFFECT_ERRORS).filter(message => error.message.includes(message))
        : []
      if (failures.length) failures.forEach(message => toast.error(message))
      else toast.error("Could not save. Please try again.")
      throw error
    }
  }, [])

  useEffect(() => {
    const off = bridge.on('store:changed', (next: Settings) => {
      snapshotVersion.current++
      setSettings({ ...DEFAULT_SETTINGS, ...next })
    })
    void reload()
    return off
  }, [reload])

  useEffect(() => {
    let active = true, received = false
    const off = api.i18n.onChanged(next => { received = true; setSystemLanguage(next) })
    void api.i18n.getLanguage().then((next: string) => { if (active && !received && next) setSystemLanguage(next) }).catch(() => undefined)
    return () => { active = false; off?.() }
  }, [])
  useEffect(() => { document.documentElement.lang = locale }, [locale])

  const value = useMemo(() => ({ settings, locale, loaded, patch, reload }), [settings, locale, loaded, patch, reload])
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useAppSettings() {
  return useContext(SettingsContext)
}
