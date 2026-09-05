import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// Use the image renderer already supplied by our Capacitor asset tooling.
const requireAssets = createRequire(import.meta.resolve('@capacitor/assets'))
const sharp = requireAssets('sharp')
const root = new URL('../', import.meta.url)
const source = fileURLToPath(new URL('assets/icon.svg', root))
const outputs = [
  'assets/icon-only.png',
  'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',
]

for (const output of outputs) {
  await sharp(source)
    .resize(1024, 1024)
    .removeAlpha()
    .png()
    .toFile(fileURLToPath(new URL(output, root)))
  console.log(`Generated ${output}`)
}
