# hyPer

hyPer is an **open-source, mobile-first web app** that combines **nutrition tracking** and **hypertrophy training logging** in one place.

Instead of juggling multiple apps, you can log meals, run workout sessions, track progression, and monitor volume/recovery signals from a single dashboard.

## What the app does

- Log food and macros throughout the day
- Start, track, and complete workout sessions
- Record sets/reps/loads and review workout history
- Track training volume and progress trends
- Build/manage hypertrophy split templates
- Use evidence-backed recommendations (peer-reviewed research references)

## Why hyPer

Most fitness tools are either:
- good at lifting logs but weak on nutrition, or
- good at nutrition but weak on serious training progression.

hyPer is built to unify both for people training for muscle growth.

## Tech stack

- **Frontend:** React 19 + TypeScript
- **State:** Zustand
- **Styling/UI:** TailwindCSS 4 + Motion
- **Backend/Auth/DB:** Supabase
- **Charts:** Recharts
- **Build tool:** Vite
- **Testing:** Vitest + ESLint

## Getting started

### 1) Install dependencies

```bash
npm install
```

### 2) Configure environment variables

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_USDA_API_KEY=your_usda_api_key
```

### 3) Run the app

```bash
npm run dev
```

App runs on Vite's local dev server (typically `http://localhost:5173`).

## Available scripts

```bash
npm run dev            # Start development server
npm run build          # Typecheck + production build
npm run preview        # Preview production build locally
npm run lint           # Lint codebase
npm run test           # Run test suite once
npm run test:watch     # Run tests in watch mode
npm run evidence:import # Import/update evidence dataset
```

## Quality checklist (before shipping changes)

```bash
npm run test
npm run lint
npm run build
```

## Project structure (high level)

```text
src/
  components/   # UI components (auth, dashboard, workout, shared)
  pages/        # Main app screens
  stores/       # Zustand state stores
  lib/          # Supabase client, animation presets, utilities
  data/         # Evidence + split templates
scripts/        # Tooling scripts (evidence import)
```

## Open source

hyPer is open source and intended to keep improving with real training + nutrition workflows.

If you want to contribute, start by opening an issue describing:
- the problem,
- expected behavior,
- and any relevant screenshots/log context.

---

Built for lifters who care about both **performance** and **consistency**.