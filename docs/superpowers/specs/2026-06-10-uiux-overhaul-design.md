# hyPer Mobile UI/UX Overhaul — Design Spec

Date: 2026-06-10 · Branch: `redesign/mobile-overhaul`
Scope: frontend only. All store actions, Supabase calls, auth flow, and product behavior preserved exactly.

## 1. Candidate directions

### A. Iron Ledger (chosen)
Precision gym instrument + private coaching notebook. The warm carbon DNA matured into a
material system: charcoal-rubber canvas, inset control wells like milled steel, chalk text,
an amber "timer LED" for training action, protein-label green for nutrition, restrained berry
for risk. Data is set in tabular mono like a logbook; the serif appears only for brand and
celebratory moments. Signature motif: **the Strip** — a calibrated tick rail (plate-edge
calibration marks / rack pin holes) that encodes sets done, macros filled, rest remaining,
and volume position between landmarks.

### B. Chalk & Steel
Brutalist gym hall: near-black, stark chalk, industrial grotesk, hairline-free heavy borders,
oversized numerals, zero ornament. Memorable, but it abandons the warm carbon DNA, reads
aggressive during tired late sets, and light mode becomes an afterthought. Rejected.

### C. Field Manual
Editorial training journal: paper-first light mode, serif-led, coach's-pencil annotations,
red grading marks. Beautiful and specific, but wrong primary context (dark gym floors,
one-handed logging) and drifts from "calm instrument" to "magazine". Rejected.

**Decision: Iron Ledger.** It is the only direction that strengthens what hyPer already is,
gives every surface a functional motif, and keeps both themes intentional.

## 2. Type system — three voices

| Voice | Face | Use |
|---|---|---|
| Interface | Schibsted Grotesk | labels, body, forms, buttons, nav |
| Data | IBM Plex Mono | weights, reps, RPE, macros, timers, calendars — always `tabular-nums` |
| Brand | Instrument Serif (italic) | wordmark moments, summary statements, celebration |

Rules: micro-labels max `0.08em` tracking (kill the 0.2em everywhere-caps), data never in serif,
serif never in forms. Utilities: `.t-label` (11px caps, 0.08em), `.t-body`, `.t-data` (mono tabular),
`.t-data-lg/-xl/-hero`, `.t-display` (serif italic).

## 3. Color tokens

Dark (primary):
```
canvas        #161412      surface-1 #1E1B18   surface-2 #262220   surface-3 #2F2A26
well (inset)  #100F0D      border    white 7%  border-strong white 13%
text          #EFE9E0      text-dim  #B3A99C   muted #82796D
amber (train) #D9A05B      amber-deep #B97F3C  (pressed/active)
sage (fuel)   #94A87C      sage-deep #76905E
berry (risk)  #C26565      rose (soft warn) #A68B8B
steel (ctrl)  #8E8273      chalk (selected) #EFE9E0
```
Light: warm chalk paper, equally tuned (canvas `#F3EEE6`, surfaces cream, text `#2B241B`,
amber `#9C6F2F`, sage `#5C7547`, berry `#A14F4F`) — not an inversion.

Meaning: amber = training action/active/timer · sage = nutrition/complete · berry = risk/destructive
only · steel/chalk = controls & selection · graphite = inactive data. No new raw hex in components;
everything through tokens.

## 4. The Strip (signature)

`<TrainingStrip>`: a rail of calibrated ticks. Variants:
- **sets**: N ticks, filled = logged (workout rows, program day previews, history entries)
- **macro**: continuous fill with target notch (home, fuel header)
- **timer**: ticks drain right-to-left with amber glow on the live edge (rest pill)
- **volume**: position marker on a rail with MEV/MAV/MRV notches (analysis, home insight)
Always data-bound, never wallpaper.

## 5. Space / radius / depth / motion

- Spacing: 4px scale; screens `px-5`; safe-area handled by `Screen` + `BottomNav` spacer.
- Radius: controls 10px · cards 16px · sheets 24px top.
- Depth: cards = surface + 1px border; controls = inset well (darker bg + inner top shadow);
  pressed = scale 0.98 + well darkens. No decorative gradients; atmosphere stays subtle.
- Motion: existing spring set kept; pressed feedback <100ms; sheets slide with `springs.smooth`;
  set completion = tick fill + brief amber flash, never blocks next input. `prefers-reduced-motion`
  respected globally.

## 6. Component system

Existing kept API-compatible: `Button`, `Card`, `Input`, `Modal` (restyled as sheet), `BottomNav`.
New shared: `Screen`, `TopBar`, `SegmentedControl`, `EmptyState`, `StickyActionBar`, `FormField`,
`SelectSheet` (replaces `<select>`), `DateTimePicker` (chips + calendar + time columns, replaces
native date/time), `Stepper`, `Chip`, `Toast`, `TrainingStrip`, `MacroBar`.
Workout: `WorkoutSetRow`, `RestTimerPill`, `SessionHeader`. Nutrition: `PhotoCapture`.

## 7. Screen architecture

- **Home → Today**: protagonist = next action. Hero card (next workout / resume / rest cue) with
  strip, macro strip row linking to Fuel, one insight (volume/readiness), quick log dock.
  First-run: guided setup card (program → targets), no empty analytics.
- **Train**: flagship. Pre-session: today's day card + week strip. In session: sticky
  `SessionHeader` (elapsed, sets, finish), exercise cards with persistent thumb-friendly set rows
  (weight/reps/RPE wells, previous-performance ghost values, target chip), `RestTimerPill` docked
  above nav (ambient, expandable, never a modal), supersets as visually paired rows, completion
  sheet with serif summary.
- **Fuel**: protagonist = logging. Compact macro strips header, big Log Food action + recents/photo
  fast paths, timeline of entries (meal-colored ticks), calendar collapses behind a date chip.
  FoodLogger = staged sheet: mode tabs → purpose-built panels → confirm bar; custom date/time/
  select/photo controls; photo flow = capture → analyzing → confidence review → portion correct → confirm.
- **Program**: bottom sheet choice kept; guided = staged steps with progress rail + live preview
  card updating per answer; sticky Build CTA; lucide icons only; day cards scannable with strips.
- **Analysis → coaching**: per-muscle status cards ("Below MEV — add 3 sets"), volume strip with
  landmark notches, research detail expandable. Definitions move into a collapsible explainer.
- **History**: entries as ledger rows with strips; month calendar secondary; edit flows intact.
- **Settings**: grouped (Profile · Appearance · Nutrition targets · Saved meals · Account);
  macro calculator becomes a staged wizard sheet.

## 8. Behavior preservation contract

All `appStore`/`authStore`/`splitEditStore` signatures untouched. Supabase payloads identical.
Session restore, set save timing (per-set immediate write), superset validation, rest timer
localStorage sync, plan schedule logic, USDA search, photo edge function, saved-meal flows,
macro calculator math: unchanged. UI-only adapters live in `src/hooks/`.

## 9. Definition of done

`npm run test` · `npm run lint` · `npm run build` green; screenshots at 360/390/430 widths in
both themes; squint/thumb/specificity/slop/density/premium checks pass; no new raw hex outside
`index.css`; bottom nav never overlaps content.
