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

- Updated: 2026-02-25
- Branch: `feat/ui-warm-carbon-train-nav`
- Last commit: `d53ca4f feat(ui): shift to train-first navigation and warm-carbon styling`
- PR URL: not created yet (quick link: `https://github.com/staylan488-ux/hyPer/pull/new/feat/ui-warm-carbon-train-nav`)
- Working tree: clean

### What Changed

- Introduced train-first route structure (`/train`, `/train/program`) with backward-compatible redirects from legacy paths.
- Simplified bottom navigation to 4 tabs (Home, Train, Fuel, You) and improved active-route matching.
- Applied Warm Carbon theme foundation updates: tokenized surfaces, refined radii, tuned accents, and atmospheric background treatment.
- Updated key entry points so daily flow reaches training/program screens with fewer menu hops.

### Files Touched

- `src/App.tsx`
- `src/components/shared/BottomNav.tsx`
- `src/components/shared/Button.tsx`
- `src/components/shared/Card.tsx`
- `src/components/shared/Input.tsx`
- `src/components/shared/Modal.tsx`
- `src/index.css`
- `src/pages/Dashboard.tsx`
- `src/pages/Splits.tsx`
- `src/pages/Workout.tsx`

### Verification

- `npm run test`: PASS
- `npm run lint`: PASS
- `npm run build`: PASS

### Remaining Tasks

- Phase 2 UI work (recommended next):
  - Rework workout session UX for clearer in-session logging flow.
  - Move toward persistent set-input visibility.
  - Reduce modal interruption for rest timer behavior.

### Risks / Gotchas

- Route updates are backward-compatible via redirects, but any external bookmarks should be re-checked for expected behavior.
- `BottomNav` now hides on `/train/session`; ensure session route behavior is implemented before relying on that state.
- Build still reports the existing large chunk warning; this is non-blocking and pre-existing.

### Next Recommended Command

- `git status && git log --oneline -5`

## Short Handoff History

| Date | Branch | Commit | Summary |
|---|---|---|---|
| 2026-02-25 | `feat/ui-warm-carbon-train-nav` | `d53ca4f` | Train-first nav + Warm Carbon foundation updates |
