import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, bridge } from '../utils/bridge'
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/settings'
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
  const locale = settings.language ?? systemLanguage

  const reload = useCallback(async () => {
    try {
      const next = await api.settings.get()
      if (next) setSettings({ ...DEFAULT_SETTINGS, ...next })
    } finally {
      setLoaded(true)
    }
  }, [])

  const patch = useCallback(async (partial: Partial<Settings>) => {
    try {
      const next = await api.settings.patch(partial)
      if (next) setSettings({ ...DEFAULT_SETTINGS, ...next })
      toast.success("Saved")
    } catch (error) { toast.error("Could not save. Please try again."); throw error }
  }, [])

  useEffect(() => {
    void reload()
    return bridge.on('store:changed', (next: Settings) => setSettings({ ...DEFAULT_SETTINGS, ...next }))
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
