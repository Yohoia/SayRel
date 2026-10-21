import React from 'react'
import { createRoot } from 'react-dom/client'
import { FloatingBarApp } from './App'
import '../shared/styles/base.css'
import '../shared/utils/appearance'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FloatingBarApp />
  </React.StrictMode>
)
