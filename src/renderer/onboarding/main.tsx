import React from 'react'
import { createRoot } from 'react-dom/client'
import { OnboardingApp } from './App'
import { ToastViewport } from '../shared/components/Toast'
import '../shared/styles/base.css'
import '../shared/utils/appearance'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OnboardingApp />
    <ToastViewport />
  </React.StrictMode>
)
