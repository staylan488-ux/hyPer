import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

// Auto-update: when a new version is deployed, the fresh service worker takes
// over and this helper reloads the app immediately — no relaunch needed.
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return

    // iOS PWAs resume from background without a navigation, so the browser
    // never re-checks for updates on its own. Check on every foreground.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void registration.update()
      }
    })

    // Safety net for very long foreground sessions.
    window.setInterval(() => {
      void registration.update()
    }, 60 * 60 * 1000)
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
