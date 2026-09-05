# App icon

`icon.svg` is the vector master for the approved elegant, centered P. Its glyph is
outlined, so export does not depend on installed fonts or a network request.

- Typeface: Fraunces Italic; optical size 96, weight 460, softness 18, wonk 1.
- Glyph scale: 81% em on a 1024 × 1024 canvas.
- Alignment: centered on the visible outline in both axes; approximately 222 px
  above and below the letter. This preserves the approved lowered placement.
- Paper: `#F4F0E7`; lacquer: `#A8352A`.
- The background is opaque and square. iOS supplies the corner mask and system
  appearance effects; none are baked into the artwork.

Regenerate the master PNG and the iOS app icon from the repository root:

```sh
node scripts/generate-app-icon.mjs
```

The script uses Sharp from the existing `@capacitor/assets` toolchain and leaves
the splash screens unchanged. Both PNGs are native 1024 × 1024 opaque RGB exports.
The existing Xcode asset catalog points to `AppIcon-512@2x.png`.

The outline derives from [Fraunces in Google Fonts](https://github.com/google/fonts/tree/main/ofl/fraunces),
licensed under the SIL Open Font License; see `Fraunces-OFL.txt`.
Changes reach the phone with a new native build/TestFlight update, and should be
checked on the device because Home Screen appearance effects are applied by iOS.
