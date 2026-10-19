import React from 'react'
import { createRoot } from 'react-dom/client'
import { CardApp } from './App'
import '../shared/base.css'
import '../shared/appearance'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CardApp />
  </React.StrictMode>
)
