import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AppRoutes } from '@/app/AppRoutes'
import '@/index.css'

const _t = import.meta.env.VITE_APP_TITLE?.trim()
if (_t) document.title = _t

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  </StrictMode>,
)
