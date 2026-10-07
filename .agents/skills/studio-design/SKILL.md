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
  since 2026-10-07 it is cardless. Page sections (`.platter`) sit directly
  on the background with no fill, edge or shadow, grouped by spacing, inset
  hairlines and section labels; never nest cards or outline rows. Liquid
  glass is only for the floating layer (tab bar, toolbars, sheets, toasts).
  Controls never add their own backdrop filter.
- Pages open with `PageHeader`: a 44px bar row (back on pushed screens,
  quiet trailing actions), one eyebrow line, then the `PageTitle` serif title
  at the same height everywhere. Once the page leaves the top, the
  scroll-edge band acts as the navigation bar: stage colour solid to 4px
  above the 44px bar row's foot (`--edge-solid`, 40px under the status
  bar), then one 24px smoothstep ramp over a progressive backdrop blur
  (`ScrollEdgeVeil`: 2.5px, 1.25px, then 0.75px layers that start at the solid
  edge and are gone by 88% of the ramp), so a resting shape is hidden or
  softened, never dimmed into a crisp, shaded sliver. Keep the blur small
  and where the veil already hides most of the content: wide blur where
  content still shows smears bright shapes into halos on true black. The
  scroll column's `scroll-padding-top` (64px) keeps scrolled-into-view
  content below the ramp, and a page may grow by up to 30% of a screen so
  its end stop lands on a row rest (`restingScrollEnd`: a row's first text at
  the ramp's foot). Reduced transparency or increased contrast use a
  solid bar with no blur. The large title
  scrolls under the band and the compact title switches in over the last
  ~10px of the collapse, not a long crossfade. Like UIKit, a page never
  rests half collapsed: when scrolling ends inside the collapse range it
  settles fully expanded or fully collapsed (instantly under reduced
  motion), never while a finger or a focused field holds it; opening a sheet
  never moves the page.
  Pushed screens keep their parent tab selected (`nativeTabForPath`).
  Contextual actions are sentence-case `text-action` buttons (15px medium in
  section headers; 16px in the bar row) in the one ink tint; a disabled
  action is that tint at 30% opacity, never grey as a style.
  Sheet-level actions sit in the sheet header beside close
  (`SheetHeaderAction`). Sheets sit over a uniform dim (black at 50% in
  Black, 28% in Ivory) and cast no shadow; in Black the sheet surface is
  flat #161616 at 97% with no wash or sheen, in Ivory an opaque #F7F7F3,
  so nothing behind it shows through; a single-detent confirmation
  sheet hides the grabber, and the close button when its own actions
  include a cancel (`Modal` `showGrabber` / `showClose`). Tracked caps are
  for section labels and kickers only; status labels, disclosure rows and
  units are sentence case (units beside or under a figure at 13px
  secondary: "sets", "eaten", "of 2,600 kcal target"). Sheet titles use the
  editorial `sheet-title`.
- Primary actions are solid, sentence-case capsules (`Button` primary: near
  white on Black, ink on Ivory) with no gloss, rim or chrome. The live workout's
  set save key is the one distinctive control (pearl or graphite, flat).
  Secondary actions are flat neutral tints; contextual row actions
  stay unboxed. A `MetalRing`
  dial carries a screen's single headline ratio (Today's session, Fuel's
  calories); lists state counts inline ("3/9 sets"). Rings and
  `RailStrip` bars are flat ink; target ticks are a neutral at 3:1 or more
  (`--rail-target`), lacquer only for live and over.
  Meaningful touch targets are at least 44px.
- Segmented controls use native metrics, 15px medium labels (a locked
  control dims to 40% as a whole, takes no touches and keeps its caption;
  its thumb loses its shadow; the light track is #EAEAE4 and the light
  thumb warm white #FDFDF9): a 36px capsule track, 2px inset,
  equal segments and a 32px thumb, each segment's hit area extended to 44px.
- Search fields are flat capsule fills (`.search-field`; #1C1C1C on Black), never recessed;
  placeholders are at least 4.5:1 (`--color-placeholder`).
- Use the radius tokens: capsule for buttons, chips, segmented tracks and the
  web tab bar; controls/inputs 14px; platters 26px; sheets 30px (floating
  phone sheets 34px at the top, 47px at the bottom, concentric with the
  display).
- Calendar headers (Fuel's week strip, History's month) are one component
  (`CalendarHeader`) at the same offset: the month in sentence case, the
  year only when it is not this year, no disclosure glyph (Fuel's month is
  still a button that opens the month calendar), and paging chevrons with
  44pt keys 52pt apart whose last glyph ends on the trailing guide. Both
  grids use the same weekday letters and letter-to-date spacing and a 34pt
  selected disc; History's day marks sit just under the disc on a 56px row
  pitch, so they read as their own date's. A section
  label sits about 40px (cap to cap) above its first row's title.
- Preserve the inset four-tab navigation: native iOS 26 glass when available,
  web fallback elsewhere. The web bar matches the native geometry: 62px tall,
  about 21px above the screen's bottom edge, 24px icons on one 1.6px stroke
  (`TabIcons`, an upright plain dumbbell; the current tab's glyph is its
  filled variant), 10.5px semibold
  labels, no ring or directional highlight (Ivory: one faint shadow and no
  hairline; Black: a flat #161616 at 94% with a uniform 0.5px hairline and
  no wash), the current tab a flat fill (no shadow; #333333 in Black) inset 5px on every
  side and concentric with the bar, and a 14px opacity-only bottom fade
  from the bar's top edge, so content dissolves before the bar and a solid
  fill resting near it is never graded into a ball. On iOS 26 the rest bar and status toasts are also
  native glass (`HyperGlassSurfaces`); the web versions remain the fallback and
  the web keeps all timer, save and preference behavior. The live workout is a
  full-screen cover, not a pushed page: a bare 44pt chevron-down minimises it
  to Today, the elapsed clock sits on the screen's centre line, Finish is a
  regular-weight text action, and its session ring matches Today's. That bar
  stays pinned while the session scrolls and condenses to "Title · time";
  like a large title, the session header (title and ring) settles expanded
  or wholly under the bar's solid edge when scrolling ends, with the first
  movement's content starting at the ramp's foot; the session's scroll ends
  on such a movement rest (a little extra room, at most half a screen), and
  a short session gets the room to collapse, so neither the ring nor a row
  rests split in the fade. Live
  workouts open with the Up next movement expanded; a movement's whole
  header row is its one toggle (no chevron or trailing count), expanding its
  details and inline set entry in place, with "•••" alone at the trailing
  edge. Today's set count is the one number ("Set 1 of 3", "1 of 3 sets");
  a program difference is said once ("3 sets · 1 fewer than planned"). The
  eyebrow sits about 10pt above its title, open or closed.
  Between sets (no entry open) a solid "Log set N · Movement" primary docks
  above the home indicator and above the rest bar, and opens that entry. The
  44pt save key, flush with the fields, is the screen's one distinctive key
  (pearl in Black, graphite in Ivory): a calm flat face with no bevel,
  chamfer, rim or highlight edge. The open set's numbers are 23px semibold
  tabular figures (rows below one step down at 17px, sharing a baseline with
  their 15px tabular secondary index), in fields on the well tone (#1C1C1C
  in Black). The open row's planned numbers are full ink, and the bare
  "Planned" cue naming their source (no tutorial copy) is the only sign
  they are suggestions; it shares one full 44pt row under the fields with
  Repeat last. Every enabled text action is ink; grey is never a style for
  something tappable.
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
  status, hollow (an ink outline, like the ○ status glyph) while trained
  but under MEV, lacquer only past MRV, no gloss or 3D. Beside a sentence
  (Today's insight) the figure draws only the sentence's muscle, in the
  same legend style as Progress (hollow when the sentence is about
  under-stimulation, its status ink otherwise, lacquer only past MRV), and
  leaves the rest at the silhouette's tone.
- [Preview fixtures](../../../src/preview/): use `/preview` in the dev server;
  `/preview?previewSetSave=fail` exercises save failure and Retry;
  `/preview/intro` replays brand motion and `/preview/sign-in` previews auth UI.
