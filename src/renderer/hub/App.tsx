import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { api } from '../shared/bridge'
import { TitleBar } from './components/TitleBar'
import { SideNav } from './components/SideNav'
import { DashboardPage } from './pages/Dashboard'
import { HistoryPage } from './pages/History'
import { DictionaryPage } from './pages/Dictionary'
import { SettingsPage } from './pages/Settings'
import { SettingsModalHost } from './components/SettingsModal'
import { AppSettingsProvider } from './state/settings'
import '../shared/hub.css'

export function HubApp() {
  const [ready, setReady] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState<string | null>(null)

  useEffect(() => {
    api.app
      .systemInfo()
      .then(() => setReady(true))
      .catch(() => setReady(true))

    const off = (window as any).offkey?.on?.('page:open-settings-modal', (section: string | null) => {
      if (section !== undefined) setSettingsOpen(section ?? 'general')
    })
    return () => off?.()
  }, [])

  if (!ready) return <div style={{ height: '100%', background: 'var(--paper)' }} />

  return (
    <AppSettingsProvider>
      <div className="app-shell">
        <TitleBar />
        <SideNav onOpenSettings={(section = 'general') => setSettingsOpen(section)} />
        <main className="app-content">
            <Routes>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/dictionary" element={<DictionaryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
        </main>
        <SettingsModalHost
          open={settingsOpen !== null}
          section={settingsOpen ?? 'general'}
          onClose={() => setSettingsOpen(null)}
        />
      </div>
    </AppSettingsProvider>
  )
}

export { SideNav }
