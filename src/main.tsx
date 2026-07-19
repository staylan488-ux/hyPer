import './preview/flag' // DEV-ONLY: must precede the Supabase client import
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { maybeSeedPreview } from './preview/previewSeed' // DEV-ONLY

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

maybeSeedPreview() // DEV-ONLY: seeds the stores when on a /preview URL

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
)
