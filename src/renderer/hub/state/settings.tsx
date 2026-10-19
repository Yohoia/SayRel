import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, bridge } from '../../shared/bridge'
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/settings'

type Ctx = {
  settings: Settings
  loaded: boolean
  patch: (partial: Partial<Settings>) => Promise<void>
  reload: () => Promise<void>
}

const SettingsContext = createContext<Ctx>({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  patch: async () => undefined,
  reload: async () => undefined
})

export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)

  const reload = useCallback(async () => {
    try {
      const next = await api.settings.get()
      if (next) setSettings({ ...DEFAULT_SETTINGS, ...next })
    } finally {
      setLoaded(true)
    }
  }, [])

  const patch = useCallback(async (partial: Partial<Settings>) => {
    const next = await api.settings.patch(partial)
    if (next) setSettings({ ...DEFAULT_SETTINGS, ...next })
  }, [])

  useEffect(() => {
    void reload()
    return bridge.on('store:changed', (next: Settings) => setSettings({ ...DEFAULT_SETTINGS, ...next }))
  }, [reload])

  const value = useMemo(() => ({ settings, loaded, patch, reload }), [settings, loaded, patch, reload])
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useAppSettings() {
  return useContext(SettingsContext)
}
