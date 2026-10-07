---
name: studio-design
description: Apply hyPer's approved Studio design when creating or editing its interface, typography, layout, controls, or motion.
---

# Studio design

Continue the approved Studio design. Reuse the existing shared components and
tokens; an already approved direction does not need another design exploration.

## Typography and color

- Fraunces carries page titles; Geist carries interface text and compact
  tabular data. Key figures and counters use the platform system sans through
  `--font-metric` (SF on Apple platforms), weight 500, tabular digits and
  -.025em tracking. Use system sans medium with monospaced digits for native
  metric counterparts. There is no separate monospace voice.
- Current roles are 40px/1.06 Fraunces titles, 44px/1 system-sans key figures,
  14px/1.45 body, 12px/1.4 support, and 11px/1.4 labels. Adapt for readability
  and accessibility without truncating meaningful names.
- Use the current Ivory/Black theme tokens and one restrained Lacquer red accent:
  Ivory (#F5F5F0) under a soft neutral ambient light, and true Black (#000000)
  with no light pool. Greys stay truly neutral; never a blue, grey-violet or
  purple cast, spectral glow or colored light wash.
  Positive/completed states use ink; use semantic tokens for both themes.
- `text-base` collides with the `--color-base` theme color in Tailwind v4;
  use `text-[1rem]` when a 16px font size is intended.

## Structure and controls

- The approved Liquid direction (2026-10-06, "Metal accents") is in
  [the liquid metal plan](../../../docs/plans/2026-10-06-liquid-metal.md):
  page sections sit on `.platter` glass panels (grouped lists use
  `platter-flush` + `platter-row`); floating chrome is liquid glass with a
  specular edge; editorial content inside platters stays ruled. Nested cards
  and controls never add their own backdrop filter.
- Pages open with `PageHeader`: a 44px bar row (back on pushed screens,
  quiet trailing actions), one eyebrow line, then the `PageTitle` serif title
  at the same height everywhere; it condenses into the scroll-edge band.
  Pushed screens keep their parent tab selected (`nativeTabForPath`).
  Contextual actions are sentence-case `text-action` buttons; tracked caps
  are for section labels only. Sheet titles use the editorial `sheet-title`.
- Primary actions are metal-capped capsules (`Button` primary: graphite dome in
  Black, pearl in Ivory, still chrome bezel). Exactly one hero action per
  screen may pass `metal` for the live, tilt-lit bezel. Secondary actions are
  clear glass capsules; contextual row actions stay unboxed. Progress uses
  `MetalRing` dials and metal `RailStrip` bars. Meaningful touch targets are at
  least 44px.
- Use the radius tokens: capsule for buttons, chips, segmented tracks and the
  web tab bar; controls/inputs 14px; platters 26px; sheets 30px.
- Preserve the inset four-tab navigation: native iOS 26 glass when available,
  web fallback elsewhere. On iOS 26 the rest bar and status toasts are also
  native glass (`HyperGlassSurfaces`); the web versions remain the fallback and
  the web keeps all timer, save and preference behavior. Workouts open as a movement list; tapping a movement
  expands its details and inline set entry in place, with an explicit collapse.
  Keep drafts when rows or movements close. Rest uses a compact anchored bar,
  starts only after a successful set save (or an explicit manual start), and
  continues while browsing or editing. Failed saves retain numbers and Retry.
  Reorder movements in Reorder mode, with drag handles and keyboard support;
  move supersets together. Save order to the session, preserve mounted drafts,
  and restore the previous order with an error if saving fails.

## Motion and mobile behavior

The approved Kinetic direction (2026-09-26) keeps Studio's type, color and
layout and makes motion, data and 3D the expressive layer.

- Routes appear immediately and restore their scroll position. Never transform
  the route ancestor or add route transitions: that captures viewport-fixed
  workout/native overlays. Fixed layers (scroll-edge band, FX) live inside the
  untransformed route content or portal to `body`.
- Use the named springs in `src/lib/animations.ts`: `tactile` for contact,
  `settle` for state, `lift` (the only visible overshoot) for celebrations,
  `heavy` for large objects. Move with transform/opacity, never width/left.
- Data draws itself once per session per metric (`reveal` keys via
  `useFirstReveal`), not on every tab visit. Charts are custom SVG/div from
  `src/components/shared/charts/`; scrubbing gives one selection haptic per
  datum and leaves vertical scrolling to the page.
- Celebrations, particles, 3D scenes and motion-reactive light are allowed for
  meaningful moments. They must never delay a save, focus or navigation; load
  heavy code lazily; pause when hidden; and fall back to 2D without WebGL.
- `useMotionPolicy` is the shared policy: reduced motion skips decorative
  motion entirely (final state, no slow-motion); reduced transparency or
  increased contrast removes moving light and blur. Keep the brand intro's
  skip/cleanup behavior and reduced-motion bypass.
- Preserve safe areas, visible-viewport keyboard behavior, nested sheet focus,
  and background isolation. Inspect changed UI in Ivory/Black at phone widths.

## Implementation references

- [Tokens and typography](../../../src/index.css), [route shell](../../../src/App.tsx).
- [Material tokens](../../../src/styles/materials.css),
  [liquid glass and metal](../../../src/styles/liquid.css).
- [Shared controls and sheets](../../../src/components/shared/),
  [motion primitives](../../../src/lib/animations.ts),
  [motion policy](../../../src/lib/motionPolicy.ts),
  [Kinetic surfaces](../../../src/styles/kinetic.css).
- 3D scenes live in [src/components/three](../../../src/components/three/) and
  load only through dynamic `import()`; they share the
  [renderer host](../../../src/lib/three/host.ts) and the
  [motion light](../../../src/lib/motionLight.ts). Weekly volume is a flat,
  matte front/back [muscle map](../../../src/lib/volumeMap.ts): ink by volume
  status, lacquer only past MRV, no gloss or 3D.
- [Preview fixtures](../../../src/preview/): use `/preview` in the dev server;
  `/preview?previewSetSave=fail` exercises save failure and Retry;
  `/preview/intro` replays brand motion and `/preview/sign-in` previews auth UI.
