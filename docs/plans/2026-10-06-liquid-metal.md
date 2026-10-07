# Liquid glass and liquid metal

## Approved direction

On 2026-10-06 the owner asked for a drastic jump in premium feel inspired by
Apple's iOS/macOS Liquid Glass and Brett's "liquid metal" study (a dark domed
send button whose thin chrome bezel carries drifting highlights with orange
and blue dispersion at their edges). Of three directions the owner chose
**Metal accents**, and then asked for the change to be a drastic jump rather
than a reskin.

This supersedes the 2026-09-04 "diffuse materials" refinement where they
conflict (that refinement banned bright rims and specular edges). Studio's
typography and Ivory/Black foundations remain.

## System

Materials live in `src/styles/materials.css` (tokens) and
`src/styles/liquid.css` (glass edges, metal, rings, rails, platters).

- **Stage.** Ivory `#F5F5F0` or true Black, lit by one soft neutral pool of
  light from above (`--material-ambient`). Never a colored page wash.
- **Platters.** Page sections sit on `.platter` panels: 26px radius, a
  translucent fill, a specular top edge and a soft shadow. They do not blur.
  `.platter-flush` + `.platter-row` make iOS-style grouped lists (rows padded
  `px-5 py-4`, hairline dividers between rows). Platters stack with 16px
  gaps; a section label may sit above a list platter (`t-label px-1 mb-3`).
- **Liquid glass.** Floating chrome only: tab bar, sheets, toasts, rest bar,
  menus. Saturated backdrop blur plus a 1px specular ring that follows the
  motion light. Cards inside sheets and platters never add their own blur.
- **Liquid metal.** A chrome bezel in two conic layers turning at unrelated
  speeds, tilted by the motion light. `Button variant="primary"` carries a
  still bezel (`metal-static`); `metal` makes it live (`liquid-metal`). Use
  `metal` for a screen's single hero action only (Resume, Start workout, Log
  food, Save set). The dome is dark graphite in Black and pearl in Ivory.
- **Chrome dials and rails.** `MetalRing` shows a single headline ratio
  (sets done, calories eaten). `RailStrip` ink fills are polished metal bars in
  capsule grooves; over-target stays lacquer.
- **Hero figures.** `.number-hero` / `.t-data-hero` are titanium (Black) or
  graphite (Ivory) gradients.
- **Live aura.** `.liquid-aura` is spectral light pooling at a bottom edge,
  only while something is live or thinking (session in progress, photo
  analysis). `.is-quiet` for ambient use.
- **Shape.** Buttons, chips, segmented tracks and the web tab bar are
  capsules (`--radius-capsule`). Inputs and wells use `--radius-control`
  (14px). Sheets 30px. Platters 26px. Editorial content inside platters
  stays square and ruled.
- **Type.** Unchanged: Fraunces titles, Geist interface, system-sans metrics.

## Round two: Chrome everywhere

After living with the first pass on device, the owner asked for the full
intensity ("I want to be wowed"), so the direction moved to the card's
"Chrome everywhere" option while keeping the serif titles and the red accent.
The first pass is recoverable at commit e048f80. Additions, in
`src/styles/chrome.css`:

- **Light field.** `LightField` puts slow pools of light under the app
  (moonlight, a faint ember of the accent and indigo in Black; pearl, blush
  and cool blue in Ivory) that drift and lean with tilt. Fine grain dithers
  them. While a session is live the viewport carries `data-live` and a
  spectral aura rises behind the tab bar. The whole viewport is a lit
  surface, so anything can read `--light-x/--light-y`.
- **Glass platters.** Platters and workout movements blur the field and carry
  a 1px chrome hairline that swings with tilt.
- **Chrome everywhere.** Every primary has the live bezel (`metal` makes the
  hero's heavier). Secondary buttons, segmented tracks, icon tiles and sheet
  close buttons get the hairline; the selected segment and chips are metal
  caps. Titles, sheet titles, movement names and hero figures are polished
  chrome type with a horizon line that slides with tilt; glyphs in tiles and
  secondary buttons are stroked with the `ChromeDefs` gradient.
- **Liquid orb.** `LiquidOrb` is a glass sphere holding mercury at the level
  of a ratio, level with the horizon as the phone tilts, in two slow waves;
  over target it turns to red lacquer. It is the headline ratio on Today
  (session sets, calories) and Fuel.
- **Live glow.** `LiveGlow` adds the Siri-like aura and a flowing spectral
  rim to the session-in-progress hero; the open movement in a session carries
  the rim alone.

## Accessibility and fallbacks

Reduced motion freezes metal at a fixed angle and stops the aura, the light
field and the orb's waves. Reduced
transparency or increased contrast removes blur, specular rings and gradients:
metal becomes a solid ink ring and figures solid ink. The light field,
spectral rims and platter blur go away, hairlines become plain borders and
chrome type and glyphs return to ink. Forced colors drops the
decorative layers. Touch targets stay at least 44px.
