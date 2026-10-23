---
name: studio-design
description: Apply hyPer's approved Metal design (the current Studio direction) when creating or editing its interface, typography, layout, controls, or motion.
---

# Metal design

Metal (approved 2026-10) is the current Studio direction: Fraunces figures on
real black or ivory, hairlines instead of boxes, and one floating command
capsule with a liquid-metal ring per screen. Build from the shared tokens and
primitives; an approved direction does not need another design exploration.
Today and the workout are the reference implementation; every other screen
and sheet follows the same structure. Screen-specific styles live next to
their pages (`fuel.css`, `history.css`, `program.css`, `settings.css`,
`RunTracker.css`); promote a class to `metal.css` once a second screen needs
it.

## Color

- Dark is true black (#000000); light is ivory (#F5F5F0). Ink is #F2F2EE /
  #161616, with `--metal-ink-2` for support text and `--metal-ink-3` for muted
  figures. The one accent is red: #D9503F dark, #A8352A light. No purple, no
  other accent hues, no glowing outlines or colored rims.
- Use the `--metal-*` tokens in `src/styles/metal.css` (they also remap the
  legacy `--color-*` tokens). Completed/positive states use ink, not green.
- `text-base` collides with `--color-base` in Tailwind v4; use `text-[1rem]`.

## Type scale

Fraunces is the figure and title voice; Geist carries everything else.

| Role | Spec | Use |
|---|---|---|
| Hero figure | Fraunces 104px/0.86, 340, opsz 144, −.035em; denominator in ink-3 | `HeroFigure`, one per screen |
| Big figure | Fraunces 44px/0.92 + 13px unit | `BigFigure` (e.g. kcal left) |
| Capsule value | Fraunces 27px + 12px unit | command capsule values |
| Page title | Fraunces 40px, opsz 144 | `PageTitle` on unmigrated pages |
| Screen title | Fraunces 30px/1.1, 360, opsz 72 + 13px Geist note on the baseline | `MetalTitle` |
| Sheet title | Fraunces 24px, 360, opsz 72 | `Modal` |
| Label | Geist 12px/16px, 500, sentence case, ink-2 | `Eyebrow`: section heads and Today's live status |
| Line / row title | Geist 15px (rows 500) | `.metal-line`, `HairlineRow` |
| Support | Geist 13px, ink-2; notes and hero captions 15px | captions, details, notes |
| Capsule label | Geist 17px 500 / 13px sublabel | command capsule |

Figures use lining proportional digits (`.metal-num`); counters that tick use
tabular digits. Sentence case everywhere, with no spaced capitals: the only small type is the
tab bar's 11px labels and single day letters. Half-pixel sizes are not used.
Never truncate a meaningful name; let titles wrap.

## Layout: sections and lists

- Page: 20px gutters (`.metal-page`), a title row (`MetalTitle` with its
  context as the baseline note; nothing sits above the title except Today's
  live status), then the hero figure with its caption on the baseline and a full-width segmented hairline
  (`SegmentedHairline`: 2px segments; `wide` for few segments).
- Sections (`MetalSection`): a 0.5px rule, 30px above, a 12px label head with
  an optional right side (a count, dots, or one `LineButton`). No cards, and never
  cards inside cards; space and hairlines do the grouping.
- Lists (`HairlineList` + `HairlineRow`): unboxed rows with title, detail,
  value and a 7×12 chevron when they navigate; 44pt minimum height.
- Thin bars (`MetalRail`): 2px track, ink fill, red when over target.
- Flags (`.metal-flag`): a 2×13 red tick before one line that needs attention.
- `EntryRow` (Progress / Program / History) is the only raised control in
  Metal; do not reuse its bevel elsewhere. No neumorphic or puffy controls.
- No hard line under the status bar; the shell's scroll edge handles it.

## The command capsule and the one ring

- A screen's single primary action goes on the command capsule:
  `useCommandCapsule(spec | null)` from `@/components/metal`. The shell renders
  it; the newest registration wins and it hides when its screen unmounts.
  Pass `null` while loading or when there is no primary action.
- Spec: `label` + `sublabel` (or `values` + `caption` for editable numbers),
  `glyph` (`arrow` go, `plus` add, `check` log), optional `progress` (thin red
  line), `busy`, `alert` (red sublabel), and `dock` (`tabbar` on tab routes,
  `bottom` on chromeless routes, where it rides above the rest bar).
- The capsule's `MetalRing` is the one ring per screen. Never place another
  ring, and never invent a second visual for the same action on screen.
- It hides itself for sheets (`#root[inert]`) and the keyboard. Content clears
  it through `.pb-nav`; custom fixed-bottom layouts add
  `var(--metal-capsule-clearance, 0px)`.
- The capsule calls existing handlers; it never owns data or save logic. The
  workout capsule logs through the set row's own save (`setEntryRegistry` →
  `WorkoutSetRow.handleSave`), shows suggested values in ink-2 and logs exactly
  what it shows; a value tap opens and focuses the inline row.

## Controls and sheets

- `Button`: capsules in sentence case. `primary` is an ink hairline (no filled
  slab), `secondary` a quiet hairline, `ghost` unboxed, `danger` red hairline.
  Prefer the command capsule for the main action. Touch targets ≥ 44pt.
- `LineButton`: the 32pt hairline capsule (44pt hit area) for a section's
  secondary action ("+ Log food"); `.metal-text-btn` for plain text actions.
- Inputs: transparent with a hairline, 12px radius, ink outline on focus, red
  when invalid. `SegmentedControl`: hairline track with a filled pill. `Chip`:
  hairline capsule, selected fills with ink. `Stepper`: hairline circles and a
  Fraunces 28px readout. Toasts are solid capsules.
- Sheets (`Modal`, `.studio-sheet`): solid `--metal-sheet` (#111111 dark,
  #FFFFFF light), no blur or gradients, 28px top radius, 36×5 handle, 24px
  Fraunces title, 44pt hairline-circle close.
- Tab bar: keep the native iOS 26 glass bar exactly as is. The web fallback has
  no pill: 11px medium labels, inactive #8E8E93 / #6C6C70, active in ink with a
  4px red dot. The rest bar and status toasts stay native glass on iOS 26.

## Workout behavior (unchanged by Metal)

Workouts open as a movement list; tapping a movement expands its details and
inline set entry in place, with an explicit collapse. Keep drafts when rows or
movements close. 0 lb and 0 reps are valid. Rest starts only after a
successful set save (or an explicit manual start) and continues while
browsing or editing. Failed saves retain numbers and offer Retry. Reorder
movements with a visible drag handle and keyboard support; supersets move and
log in rounds together.

## Motion

- Routes appear immediately and restore scroll; never transform the route
  ancestor or add route transitions. Fixed layers live inside untransformed
  content or portal to `body`.
- Use the named springs in `src/lib/animations.ts` (`tactile`, `settle`,
  `lift`, `heavy`); move with transform/opacity. The capsule morphs with
  `settle` and cross-fades its label.
- The ring loads lazily into one shared WebGL context, pauses when hidden or
  off screen, takes its light from `subscribeMotionLight` (CoreMotion on iOS),
  and falls back to a static CSS ring without WebGL.
- `useMotionPolicy`: reduced motion shows final states (the ring is a still
  frame); reduced transparency or increased contrast removes moving light and
  blur. Data draws once per session per metric. Celebrations never delay a
  save, focus or navigation. Keep the brand intro's skip and reduced-motion
  bypass; its wordmark stays on Today.
- Preserve safe areas, keyboard behavior, nested sheet focus and background
  isolation. Inspect changes in both themes at 402pt wide.

## Implementation references

- [Metal tokens and primitives](../../../src/styles/metal.css),
  [Metal components](../../../src/components/metal/),
  [capsule store](../../../src/lib/commandCapsule.ts),
  [capsule hook](../../../src/hooks/useCommandCapsule.ts).
- Reference screens: [Today](../../../src/pages/Dashboard.tsx) with
  [its model](../../../src/components/dashboard/todayModel.ts), and the
  [workout capsule](../../../src/components/workout/WorkoutCommandCapsule.ts).
- [Shared controls and sheets](../../../src/components/shared/),
  [motion primitives](../../../src/lib/animations.ts),
  [motion policy](../../../src/lib/motionPolicy.ts),
  [motion light](../../../src/lib/motionLight.ts),
  [route shell](../../../src/App.tsx).
- 3D scenes load only through dynamic `import()` from
  [src/components/three](../../../src/components/three/) and share the
  [renderer host](../../../src/lib/three/host.ts).
- [Preview fixtures](../../../src/preview/): `/preview` in the dev server;
  `/preview?today=planned|live|rest|done|flexible|no-schedule|first-run` sets
  Today's state; `/preview?previewSetSave=fail` exercises save failure and
  Retry; `/preview/intro` replays the brand intro.
