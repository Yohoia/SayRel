import { AppSettingsProvider } from '../shared/state/settings'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { CardApp } from './App'
import { ToastViewport } from '../shared/components/Toast'
import '../shared/styles/base.css'
import '../shared/utils/appearance'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppSettingsProvider>
    <CardApp />
    <ToastViewport />
      </AppSettingsProvider>
  </React.StrictMode>
)
