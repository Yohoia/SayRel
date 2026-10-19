import React from 'react'
import { createRoot } from 'react-dom/client'
import { SidebarApp } from './App'
import '../shared/base.css'
import '../shared/appearance'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SidebarApp />
  </React.StrictMode>
)
