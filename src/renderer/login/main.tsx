import React from 'react'
import { createRoot } from 'react-dom/client'
import { LoginApp } from './App'
import '../shared/base.css'
import '../shared/appearance'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LoginApp />
  </React.StrictMode>
)
