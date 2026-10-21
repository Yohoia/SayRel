import React from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { HubApp } from './App'
import '../shared/styles/base.css'
import '../shared/utils/appearance'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <HubApp />
    </HashRouter>
  </React.StrictMode>
)
