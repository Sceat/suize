import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { boot } from './lib/theme'
import './theme.css'
import './sections.css'
import './product.css'
import App from './App.jsx'

// set <html data-theme> before first paint (default LIGHT) — no flash.
boot()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
