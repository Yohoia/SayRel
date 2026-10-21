import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { api, bridge } from '../shared/utils/bridge'
import { TitleBar } from './components/TitleBar'
import { HubHeader } from './components/HubHeader'
import { DashboardPage } from './pages/Dashboard'
import { HistoryPage } from './pages/History'
import { DictionaryPage } from './pages/Dictionary'
import { SettingsPage } from './pages/Settings'
import { ProvidersPage } from './pages/Providers'
import { SettingsModalHost } from './components/SettingsModal'
import { AppSettingsProvider } from './state/settings'
import { ToastViewport } from '../shared/components/Toast'
import '../shared/styles/hub.css'
import '../shared/styles/home.css'

export function HubApp() {
  const home = useLocation().pathname === '/dashboard'
  const [ready, setReady] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState<string | null>(null)

  useEffect(() => {
    api.app
      .systemInfo()
      .then(() => setReady(true))
      .catch(() => setReady(true))

    const off = bridge.on('page:open-settings-modal', (section: unknown) => {
      if (typeof section === 'string' || section === null) setSettingsOpen(section ?? 'general')
    })
    return () => off?.()
  }, [])

  if (!ready) return <div style={{ height: '100%', background: 'var(--paper)' }} />

  return (
    <AppSettingsProvider>
      <div className="app-shell instrument-home">
        <TitleBar />
        <HubHeader onOpenSettings={(section = 'settings') => setSettingsOpen(section)} />
        <main className={'app-content' + (home ? ' is-home' : '')}>
            <Routes>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/dictionary" element={<DictionaryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/providers" element={<ProvidersPage />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
        </main>
        <SettingsModalHost
          open={settingsOpen !== null}
          section={settingsOpen ?? 'general'}
          onClose={() => setSettingsOpen(null)}
        />
        <ToastViewport />
      </div>
    </AppSettingsProvider>
  )
}
