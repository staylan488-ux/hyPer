# Hypertrophy App - Claude Code Memory

## Project snapshot
- Mobile-first hypertrophy + nutrition tracking web app.
- Stack: React 19, TypeScript, Zustand, TailwindCSS 4, Supabase, Vite.
- Goal right now: stabilize and iterate safely; keep UX quality high on mobile.

## Runbook commands
- Install: `npm install`
- Dev: `npm run dev`
- Test: `npm run test`
- Lint: `npm run lint`
- Build: `npm run build`
- Evidence import: `npm run evidence:import`

## Definition of done (required)
Before marking any task complete, run and pass:
1. `npm run test`
2. `npm run lint`
3. `npm run build`

## Must-work product flows
1. Nutrition/Food logging with time.
2. Workout start/log/complete and set save behavior.
3. Editing past workouts and nutrition entries.
4. Volume recommendation/status behavior.
5. Program management (view/edit/delete active program).
6. Session restore/sign-in persistence.

## Current priorities
1. Frontend quality and mobile polish.
2. Preserve existing behavior while improving UI.
3. Keep implementation consistent with existing patterns/components.

## Guardrails
- Do not expose secrets; do not print `.env` values.
- Avoid changing auth flow and DB schema unless explicitly asked.
- Keep changes scoped; avoid unrelated refactors.
- Prefer plan -> implement -> verify workflow for non-trivial tasks.

## Frontend quality bar
- Present 2-3 visual direction options before major UI redesigns.
- Design for mobile first, then desktop.
- Use clear visual hierarchy, intentional spacing, and consistent states.
- Verify final behavior with existing pages/components conventions.

## Cross-tool handoff protocol
- Before starting major work, read `TOOL_SWITCHING_CHECKLIST.md`.
- If work is handed over from another agent, start by verifying:
  1. Current branch (`git branch --show-current`)
  2. Working tree (`git status --short`)
  3. Latest commits (`git log --oneline -5`)
- Require concise handoff details: branch, last commit, files touched, verify results, remaining tasks.
- Keep bugfix branches separate from large refactor branches.

## Communication style for user
- User is technical but not a programmer.
- Explain in plain English first, then include technical details if needed.
- Keep outputs concise and action-oriented.
