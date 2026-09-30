import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// Use the image renderer already supplied by our Capacitor asset tooling.
const requireAssets = createRequire(import.meta.resolve('@capacitor/assets'))
const sharp = requireAssets('sharp')
const root = new URL('../', import.meta.url)
const source = fileURLToPath(new URL('assets/icon.svg', root))
const outputs = [
  { path: 'assets/icon-only.png', size: 1024 },
  { path: 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', size: 1024 },
  // Web/PWA icons referenced by index.html and the manifest in vite.config.ts.
  { path: 'public/apple-touch-icon.png', size: 180 },
  { path: 'public/pwa-192x192.png', size: 192 },
  { path: 'public/pwa-512x512.png', size: 512 },
]

for (const { path: output, size } of outputs) {
  await sharp(source)
    .resize(size, size)
    .removeAlpha()
    .png()
    .toFile(fileURLToPath(new URL(output, root)))
  console.log(`Generated ${output}`)
}
