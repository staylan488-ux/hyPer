# hyPer — Project Context & Handoff

> Read this file first when picking up work. Pair with `CLAUDE.md` for guardrails, must-work flows, and runbook commands.

---

## 1) What this project is

- **Brand name**: hyPer (exact mixed-case — never "Hyper", "HYPER", or "HyPer")
- **One-liner**: A mobile-first web app for science-based hypertrophy training and nutrition tracking.
- **Primary user**: Serious gym-goers who want workout logging, nutrition intake, and volume tracking in one app — backed by peer-reviewed research.
- **Current status**: Post-MVP. Core flows work. UI overhaul and rebrand complete. Iterating on polish and features.

## 2) Stack & runtime

| Layer | Tech |
|-------|------|
| Framework | React 19, TypeScript (strict) |
| State | Zustand (`src/stores/appStore.ts`, `src/stores/authStore.ts`) |
| Styling | TailwindCSS 4, motion/react (Framer Motion) |
| Backend | Supabase (auth + PostgreSQL via RLS) |
| Charts | Recharts |
| Dates | date-fns |
| Routing | React Router DOM 7 |
| Build | Vite, vite-plugin-pwa |
| Package mgr | npm |
| Env vars | `.env` — `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_USDA_API_KEY` |

## 3) Architecture map

```
src/
├── main.tsx              # Entry point
├── App.tsx               # Router + auth gate
├── index.css             # Global styles / Tailwind config
├── lib/
│   ├── supabase.ts       # Supabase client
│   └── animations.ts     # Motion presets (springs.smooth, springs.snappy, etc.)
├── stores/
│   ├── appStore.ts       # Workouts, nutrition, splits, macro targets
│   └── authStore.ts      # Auth state, sign in/up/out, session
├── components/
│   ├── auth/AuthForm.tsx  # Login/signup page
│   ├── shared/            # Button, Card, Input, Modal, Calendar — import from '@/components/shared'
│   ├── dashboard/         # MacroGauge, VolumeChart
│   └── workout/           # RestTimer, SetLogger
├── pages/                 # Dashboard, Workout, Nutrition, Analysis, History, Splits, Settings
├── data/
│   ├── evidence/          # Scientific evidence snapshot (peer-reviewed data)
│   └── splitTemplates.ts  # Predefined training split templates
└── scripts/               # import-evidence.mjs (internal tooling)
```

**Key patterns:**
- Shared components live in `src/components/shared/` and re-export from `index.ts` — always import from `'@/components/shared'`, not individual files.
- Animation presets in `src/lib/animations.ts` — use `springs.smooth`, `springs.snappy`, etc. instead of inline transition objects.
- Path alias: `@/` maps to `src/`.
- External API: USDA Food Database for nutrition search.

## 4) Branding rules

- The app name is **hyPer** — mixed-case, always.
- Any CSS on brand text must NOT use `uppercase` / `text-transform: uppercase` (it forces "HYPER").
- The word "hypertrophy" still appears in scientific contexts (Analysis page, evidence data, split templates, package.json) — these refer to the concept, not the brand. Leave them.
- Attribution line: "Built on peer-reviewed research" (no individual name-drops).

## 5) Current state

| Check | Status |
|-------|--------|
| Branch | `main` |
| Last commit | `e192894` — Merge PR #2 (UI overhaul + rebrand) |
| Working tree | Clean |
| `npm run test` | PASS (35/35) |
| `npm run lint` | PASS (clean) |
| `npm run build` | PASS (724 KB bundle warning is pre-existing, not blocking) |

### What just shipped (PR #2)
- Full UI/UX overhaul: motion animations, component restyling, page layouts
- Rebranded all user-facing text from "Hypertrophy Tracker" to "hyPer"
- Replaced Chris Beardsley attribution with "Built on peer-reviewed research"
- Updated HTML meta tags, PWA manifest, login page, and Settings footer

### Files touched in PR #2
`AuthForm.tsx`, `MacroGauge.tsx`, `VolumeChart.tsx`, `Button.tsx`, `Card.tsx`, `Modal.tsx`, `Calendar.tsx` (new), `index.ts` (shared exports), `RestTimer.tsx`, `SetLogger.tsx`, `index.css`, `animations.ts`, `Analysis.tsx`, `Dashboard.tsx`, `History.tsx`, `Nutrition.tsx`, `Settings.tsx`, `Splits.tsx`, `Workout.tsx`, `index.html`, `vite.config.ts`

## 6) Known issues / future work

- **Bundle size**: Single 724 KB JS chunk — could benefit from code-splitting with dynamic `import()`.
- No other known bugs or blockers at this time.

## 7) Decisions already made

| Decision | Why |
|----------|-----|
| Mobile-first design | Primary use case is logging at the gym on a phone |
| TailwindCSS 4 + motion/react | Already in use, consistent with component patterns |
| Zustand over Redux | Lighter, simpler for this app's scope |
| Supabase with RLS | Auth + DB in one service, anon key exposure is safe (RLS protected) |
| No custom backend | All queries go through Supabase client SDK |

## 8) Constraints

- Do not change auth flow or DB schema without explicit approval.
- Do not commit `.env` files.
- Keep changes scoped — avoid unrelated refactors.
- Run `npm run test && npm run lint && npm run build` before finalizing any work.

## 9) First actions when picking up work

1. `git branch --show-current` — confirm you're on the right branch
2. `git status --short` — confirm clean working tree
3. `git log --oneline -5` — confirm you're at the expected commit
4. Read `CLAUDE.md` for guardrails and must-work flows
5. Proceed with the task
