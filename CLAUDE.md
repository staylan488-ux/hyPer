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

## Design system — FOLIO (house style, locked)
The app uses one committed aesthetic: **editorial luxury** (print magazine / high-fashion, à la Aesop · The Row · Kinfolk). Stay inside it; do not drift back toward generic SaaS/fitness UI.
- **Type (3 voices, defined in `src/index.css`):** Fraunces (`--font-display`) = serif headlines + hero numbers; Geist (`--font-sans`) = UI/body grotesque; Geist Mono (`--font-mono`) = dense tabular data. Loaded via Google Fonts in `index.html`. Never use the system stack or Inter.
- **Data is the hero.** Render key numbers (calories, macros, weights, reps, set counts) as large serif objects: `.number-hero` / `.number-large` / `.number-medium` (also `.t-data-xl/lg`). Small dense data uses mono `.t-data` / `.t-data-sm`.
- **Palette:** warm monochrome paper+ink with ONE accent, "Lacquer" `var(--color-accent)` (deep red). Lacquer marks only one thing at a time (live/active state, the single most important number, or a destructive edge). No second hue.
- **Structure:** hierarchy from scale, weight, and negative space + hairline rules — not boxes. Square corners (radius tokens are 0; only `--radius-full` for true circles). Section pattern: `mt-10 pt-8 border-t border-[var(--color-border)]` opened by a `.t-label` eyebrow.
- **BANNED:** gradients, glows/neon, soft drop-shadow floating cards, rounded-rectangle-everything, pastel pill badges, emoji icons, centered/even/equal-weight layouts.
- **Themes:** Paper (light) is default; Ink (dark) via the toggle. Both are tokenised — only edit `var(--color-*)` tokens, never hardcode hex.
- **GOTCHA — never use the `text-base` class.** `--color-base` is a theme color, so Tailwind v4 makes `text-base` a *color* utility (= paper), silently making text invisible. For 16px body use `text-[1rem]`.
- Mobile-first (design at ~380px first), then desktop. Reference screens: `src/pages/Dashboard.tsx`, `src/components/auth/AuthForm.tsx`. Living spec: `design/folio-design-system.html`.

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
