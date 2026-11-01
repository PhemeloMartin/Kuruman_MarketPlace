import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initTranslation } from './lib/translate'

initTranslation()

// After an update the old file names are gone. A page opened before the update that now loads a
// part of the app on demand (e.g. the calling code) would fail - so reload once to get the new version.
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (sessionStorage.getItem('reloaded-for-update')) return
    sessionStorage.setItem('reloaded-for-update', '1')
  } catch {
    // no storage: still reload once
  }
  event.preventDefault()
  window.location.reload()
})
// Once the reloaded page has run a while, allow the same fix after the next update too.
setTimeout(() => {
  try {
    sessionStorage.removeItem('reloaded-for-update')
  } catch {
    // ignore
  }
}, 30_000)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
