import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'
import path from 'path'

// short commit the bundle was built from, so the Settings build stamp is an
// unambiguous fingerprint of which code a TestFlight build actually contains
function gitShortSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'nogit'
  }
}

// Libraries that change only on dependency bumps get their own long-lived
// chunk, so a PWA update re-downloads just the app code. An allow-list, not a
// node_modules catch-all: three.js, the barcode reader and Capacitor plugin
// web fallbacks must stay in their on-demand chunks.
const vendorPackages =
  /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@supabase[\\/][^\\/]+|motion|motion-dom|motion-utils|framer-motion|date-fns|lucide-react|zustand|@capacitor[\\/]core|iceberg-js|tslib)[\\/]/

const buildStamp = `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${gitShortSha()}`

export default defineConfig({
  server: {
    // allow phone testing through the Tailscale HTTPS proxy (dev-only; scoped
    // to this tailnet's domain)
    allowedHosts: ['.taileaf222.ts.net'],
  },
  define: {
    __BUILD_ID__: JSON.stringify(buildStamp),
  },
  build: {
    rollupOptions: {
      // src/preview is DEV-only. Its fixture modules build sample data at top
      // level, which Rollup would otherwise keep as side effects in the
      // production bundle. flag.ts stays side-effectful: it latches the flag.
      treeshake: {
        moduleSideEffects: (id, external) =>
          external || !/[\\/]src[\\/]preview[\\/](?!flag\.ts)/.test(id),
      },
      output: {
        manualChunks: (id) =>
          !id.startsWith('\0') && vendorPackages.test(id) ? 'vendor' : undefined,
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'hyPer',
        short_name: 'hyPer',
        description: 'A field journal for strength & nourishment',
        theme_color: '#F5F5F0',
        background_color: '#F5F5F0',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})
