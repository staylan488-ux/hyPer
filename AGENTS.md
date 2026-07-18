# AGENTS.md

Use this file as the single source of truth when handing off work between sessions or starting a new session.

## Session Startup (always first)

1. `git branch --show-current`
2. `git status --short`
3. `git log --oneline -5`
4. Read `CLAUDE.md`
5. Read `TOOL_SWITCHING_CHECKLIST.md` for context handoffs

## Operating Contract (stable)

- Workflow: Understand -> Delegate -> Split/Parallelize -> Plan -> Execute -> Verify.
- Definition of done (required):
  - `npm run test`
  - `npm run lint`
  - `npm run build`
- Keep changes scoped and preserve existing behavior.
- Do not touch auth flow or DB schema unless explicitly requested.
- Never expose secrets or commit `.env`.
- For meaningful UI work:
  - Propose 2-3 visual directions before major redesign implementation.
  - Define typography, color tokens, spacing, and motion decisions before coding.

## Role-Based Guidance

- Discovery/search: map unknown files, symbols, and references before planning.
- Documentation/research: check official docs for version-specific APIs and edge cases.
- UI/UX design: shape user-facing flows and visual polish with intentional design direction.
- Implementation: execute clear, scoped changes quickly and safely.
- Architecture/debugging: use deeper analysis for high-risk trade-offs or persistent root-cause issues.
- If your harness does not support delegation, perform these roles sequentially in one session.

## Must-Work Product Flows

1. Nutrition/Food logging with time.
2. Workout start/log/complete and set save behavior.
3. Editing past workouts and nutrition entries.
4. Volume recommendation/status behavior.
5. Program management (view/edit/delete active program).
6. Session restore/sign-in persistence.

## Handoff Template (copy/paste)

```text
SESSION HANDOFF SUMMARY
- Branch:
- Last commit hash + message:
- PR URL (if any):
- What changed:
- Files touched:
- Verification:
  - npm run test:
  - npm run lint:
  - npm run build:
- Remaining tasks:
- Risks / gotchas:
- Next recommended command:
```

## Current Handoff State

- Updated: 2026-07-17
- Branch: `main`
- Status: design elevation LIVE — merged into `main` via pull request (2026-07-17)
- Working tree: clean
- Plan file: `docs/plans/2026-07-17-design-elevation.md` (DONE)

### What Changed

Design elevation with the FOLIO language kept intact — the wow comes from motion and material, not new colors:

- Route-level page transitions (pages "turn" instead of hard-swapping); bottom nav stays mounted; one global `MotionConfig reducedMotion="user"`; pages no longer self-animate their entrance.
- Living paper: animated film-grain canvas + drifting warm light (`PaperAtmosphere`), replacing the static SVG noise; theme-aware, pauses when tab hidden, static under reduced motion.
- `RollingNumber` letterpress-odometer digits on hero figures (kcal on Today + Fuel, sets-done count, rest-timer countdown).
- Bottom sheets dismiss by pulling/flicking down from the grab rule or title row; active nav icon settles into place.

### Files Touched

- `src/App.tsx` (route shell, MotionConfig, atmosphere mount)
- `src/lib/animations.ts` (pageTransition timing)
- `src/index.css` (paperlight/papergrain layers + tokens; static body::after noise removed)
- `src/components/shared/PaperAtmosphere.tsx` (new), `src/components/shared/RollingNumber.tsx` (new)
- `src/components/shared/{index.ts,Screen.tsx,Modal.tsx,BottomNav.tsx}`
- `src/pages/{Dashboard.tsx,Nutrition.tsx,Workout.tsx}`
- `src/components/workout/RestTimerPill.tsx`

### Verification

- `npm run test`: PASS (219)
- `npm run lint`: PASS
- `npm run build`: PASS
- Visual: 390×844 screenshots of all 7 screens (Paper), Dashboard/Settings/Fuel + FoodLogger sheet (Ink); browser console clean

### Remaining Tasks

- User local test, then merge `feat/design-elevation` → `main` (or open PR).
- One manual glance: the rest-timer rolling countdown during a real logged set (actions are stubbed in preview mode).

### Risks / Gotchas

- `Screen` no longer self-animates; the route transition owns page entrances — new pages must not add their own full-page fade.
- Grain/light layers sit above all UI (z-index 60–61) and must stay `pointer-events: none`.
- Build still reports the existing large chunk warning; this is non-blocking and pre-existing.

### Next Recommended Command

- `npm run dev` then open `http://localhost:5173/preview` (mock data, no login)

## Short Handoff History

| Date | Branch | Commit | Summary |
|---|---|---|---|
| 2026-07-17 | `feat/design-elevation` | `e50da63` | Motion-led design elevation: page turns, living paper, rolling hero numbers, sheet drag-dismiss |
| 2026-02-25 | `feat/ui-warm-carbon-train-nav` | `d53ca4f` | Train-first nav + Warm Carbon foundation updates |
