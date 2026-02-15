# Project Handoff (Droid → OpenCode)

## 1) What this project is
- **One-liner**: A fitness/hypertrophy tracking mobile web app for logging workouts and nutrition in one app, with a focus on cutting-edge Science-based strength training research spearheaded by figures like Chris Beardsley.
- **Primary user/problem**: Serious science-based gym-goers who want to track their training sessions, exercises, sets, reps, and nutrition intake without having to juggle multiple apps. 
- **Current status**: Likely MVP - basic workout logging and nutrition tracking functional

## 2) Stack + runtime
- **Languages**: TypeScript, JavaScript
- **Frameworks/libraries**: React 19, Zustand (state management), TailwindCSS 4, Recharts (charts), date-fns, Supabase (auth + database), React Router DOM 7
- **Package manager**: npm (based on package.json)
- **Dev start command**: `npm run dev` (Vite)
- **Build command**: `npm run build` (tsc -b && vite build)
- **Test command**: Unknown (no test framework in package.json)
- **Lint/format command**: `npm run lint` (ESLint)
- **Env files used**: `.env` with Supabase credentials (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_USDA_API_KEY)

## 3) Architecture map (high signal)
- **Entry points**: `src/main.tsx` → `src/App.tsx`
- **Core modules/services**: 
  - `src/stores/appStore.ts` - Main application state (workouts, nutrition, user data)
  - `src/stores/authStore.ts` - Authentication state
  - `src/lib/supabase.ts` - Supabase client
- **Data layer (DB/schema/migrations)**: Supabase (PostgreSQL) - tables for users, workouts, exercises, sets, nutrition_logs, foods
- **API routes**: Supabase client-side queries (not a custom backend)
- **Background jobs/workers**: None identified
- **External integrations**: USDA Food Database API (nutrition data)

## 4) What is known vs unknown

### Known
- Mobile-first responsive design work in progress for FoodLogger time picker
- Recent fixes: SetLogger saving state, stale closure fix in logSet, workout session filtering, fetchSplits on mount
- Touch handling added to FoodLogger for mobile scroll vs tap detection

### Unknown / needs verification
- Exact database schema structure
- Whether there are actual tests in the project
- Current build/lint status
- Last time full test suite was run

- **Last full test run date**: Unknown

## 5) Current uncertainty
- **Project has not been tested recently**: Unknown - need to verify
- **Confirmed bug list available**: No - working on mobile UI fixes
- **Immediate path forward is currently unclear**: No - mobile UI fixes are clear (FoodLogger time picker overflow)

## 6) Discovery Pass objective (first step in OpenCode)

Goal: establish current truth before feature work.

### Proposed verification checklist
1. Run/install sanity check (`npm install`)
2. Run build (`npm run build`)
3. Run tests (or confirm test suite missing)
4. Run lint/typecheck (`npm run lint`, `npx tsc --noEmit`)
5. Smoke-test critical user flows manually
6. Summarize findings

## 7) Candidate priorities (only if confident; otherwise say Unknown)

1. Complete mobile responsive fixes for FoodLogger time picker (in progress)
2. Verify all recent fixes work correctly on mobile
3. Ensure build passes after changes

## 8) Decisions already made (and why)

- **Decision**: Mobile-first responsive approach for FoodLogger component
- **Why**: The time picker input was overflowing modal on mobile viewports
- **Alternatives rejected**: Full redesign of modal - too disruptive

- **Decision**: Use TailwindCSS 4 with responsive prefixes (md:, lg:)
- **Why**: Already in use and provides clean mobile/desktop breakpoints

## 9) Constraints / non-negotiables

- **Performance**: Keep bundle size reasonable for mobile
- **Security**: Supabase anon key exposure is expected (RLS protected)
- **Coding conventions**: TypeScript strict mode, React functional components with hooks
- **Areas to avoid touching without approval**: Authentication flow, database schema (unless adding migrations)

## 10) Definition of done for Discovery Pass

- [ ] Build status confirmed
- [ ] Test status confirmed
- [ ] Lint/typecheck status confirmed
- [ ] Critical flows smoke-tested
- [ ] Top 3 next tasks proposed with rationale
