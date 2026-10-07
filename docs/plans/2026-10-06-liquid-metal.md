# Liquid glass and liquid metal

## Approved direction

On 2026-10-06 the owner asked for a drastic jump in premium feel inspired by
Apple's iOS/macOS Liquid Glass and Brett's "liquid metal" study (a dark domed
send button whose thin chrome bezel carries drifting highlights). Of three directions the owner chose
**Metal accents**, and then asked for the change to be a drastic jump rather
than a reskin.

This supersedes the 2026-09-04 "diffuse materials" refinement where they
conflict (that refinement banned bright rims and specular edges). Studio's
typography and Ivory/Black foundations remain.

## System

Materials live in `src/styles/materials.css` (tokens) and
`src/styles/liquid.css` (glass edges, metal, rings, rails, platters).

- **Stage.** Ivory `#F5F5F0`, lit by one soft neutral pool of light from
  above (`--material-ambient`), or true Black with no light pool at all.
  Never a colored page wash.
- **Neutral greys.** Every grey in glass, metal, rings, rails and figures is
  a true neutral (equal R, G and B). No blue, grey-violet or purple cast.
- **Scroll edge.** Once a page scrolls, content fades into the stage just
  below the status bar (`.app-viewport::before`), never a hard cut. Under a
  condensed title the band (`.page-scroll-edge`) is solid behind the bar,
  then one eased ramp over a small progressive blur kept where the veil is
  already strong, and the web tab bar has a short bottom fade (current
  numbers in the studio-design skill).
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
- **Live aura.** `.liquid-aura` is neutral silver light (graphite in Ivory)
  pooling at a bottom edge, only while something is live or thinking
  (session in progress, photo analysis). Never spectral or violet. `.is-quiet` for ambient use.
- **Shape.** Buttons, chips, segmented tracks and the web tab bar are
  capsules (`--radius-capsule`). Inputs and wells use `--radius-control`
  (14px). Sheets 30px. Platters 26px. Editorial content inside platters
  stays square and ruled.
- **Type.** Unchanged: Fraunces titles, Geist interface, system-sans metrics.

## Accessibility and fallbacks

Reduced motion freezes metal at a fixed angle and stops the aura. Reduced
transparency or increased contrast removes blur, specular rings and gradients:
metal becomes a solid ink ring and figures solid ink. Forced colors drops the
decorative layers. Touch targets stay at least 44px.

## Round two, reverted (2026-10-07)

A "Chrome everywhere" pass (371d1c6) put chrome type, chrome hairlines on
every card, live metal on every primary, liquid-filled spheres, a drifting
colored light field and a spectral live glow across the app. On the phone the
owner judged it a clear step backwards: the chrome looked cheap, card outlines
did too much, metal lost its elegance through repetition, the spheres read as
tacky bubbles, the colored light read as default "AI" purple, dark mode was no
longer real black, and content met a hard line under the Dynamic Island when
scrolling. It was reverted, and round one was refined instead: true black,
neutral greys and white glints only, a neutral aura and a soft scroll edge.
Premium feel comes from restraint and craft, not more effects.
