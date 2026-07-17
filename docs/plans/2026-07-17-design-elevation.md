# Design Elevation — "Level up the feel, keep the language"

**Status:** DONE
**Branch:** `feat/design-elevation` (branched off latest `origin/main`, which already includes the rest-timer work)
**Date:** 2026-07-17

## Goal (user's words)

"Level up the design… keep all of the visual language — style, color scheme, the feel — but make it feel much smoother and look much nicer. Groundbreaking design, shaders maybe, animations. Functionality is the highest priority; everything must work after the redesign. Mobile-first. Prepare it so I can test locally before merging to main."

## Agreed direction (user delegated the decision)

The app's FOLIO system (editorial luxury: Fraunces/Geist/Geist Mono, paper+ink, one lacquer accent, square corners, hairlines) is the identity — **kept intact**. The elevation comes from **motion and material**, not new colors or decoration:

1. **Choreographed route transitions** — pages "turn" like leaves of a journal instead of hard-swapping (the `pageTransition` variant existed but was unused).
2. **Living paper** — the static paper grain becomes a slow, breathing film-grain canvas + a barely-there ambient warmth. Monochrome, token-driven, reduced-motion safe. This is the "shader" moment without breaking the no-glow/no-gradient rule.
3. **Numeral theater** — hero numbers (Fraunces) roll like a letterpress odometer when values change: dashboard calories, fuel page, rest-timer countdown.
4. **Chrome polish** — bottom-sheet drag-to-dismiss, sharper nav micro-motion, section hairline rules that draw in.
5. **Systemic reduced-motion** — one `MotionConfig reducedMotion="user"` at the root instead of per-component checks.

**Hard constraints:** no functionality changes; all 6 must-work flows keep working; `npm run test`, `npm run lint`, `npm run build` must pass; tokens only, no hardcoded hex; never use `text-base` class; mobile-first (~380px).

## Checklist

- [x] Branch `feat/design-elevation` created off latest `origin/main`
- [x] Codebase inventory (pages, components, motion usage) — done via explore agents
- [x] M1: Route transitions + `MotionConfig reducedMotion="user"` + unify page shells (commit `e115be9`)
- [x] M2: Living paper grain + ambient atmosphere canvas (commit `b4bca0b`)
- [x] M3: Rolling-digit hero numbers (Dashboard, Nutrition, RestTimer) (commit `a326121`)
- [x] M4: Chrome polish (sheet drag-dismiss, nav settle) (commit `e50da63`)
- [x] Verify: `npm run test` (219 pass) + `lint` (clean) + `build` (pass) after every milestone
- [x] Visual check: dev server + 390×844 screenshots of all 7 screens in Paper theme, Dashboard/Settings/Fuel/FoodLogger-sheet in Ink theme; browser console clean (no errors/warnings)
- [x] Update AGENTS.md handoff state; mark plan DONE

## Notes / decisions log

- 2026-07-17: `motion` (v12) already installed — no new dependencies needed. Recharts is installed but unused; leaving it alone (out of scope).
- Restored accidentally-deleted `.env.example` before branching.
- Workout/History pages used their own fade wrappers instead of `Screen`; M1 unifies them under one route-level transition.
- Visual verification used the DEV preview mode (`/preview` latches mock data, no login). The rest-timer pill's rolling countdown wasn't exercised visually (needs a live logged set; actions are stubbed in preview) — same component as the verified kcal heroes, but worth one glance during manual testing: start a session, log a set, watch the countdown.
- Plan DONE.

## How to test locally (for the user)

```
git checkout feat/design-elevation
npm install   # only if node_modules was cleaned
npm run dev
```
Open the printed URL (usually http://localhost:5173). Nothing is merged to `main` until you say so.

## Notes / decisions log

- 2026-07-17: `motion` (v12) already installed — no new dependencies needed. Recharts is installed but unused; leaving it alone (out of scope).
- Restored accidentally-deleted `.env.example` before branching.
- Workout/History pages used their own fade wrappers instead of `Screen`; M1 unifies them under one route-level transition.
