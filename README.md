# hyPer

hyPer is an iPhone app for training and eating to build muscle. It keeps
workout logging, nutrition tracking and training volume in one place, with
recommendations built on peer-reviewed research.

## What it does

- **Train:** run a program day or a flexible session set by set, with rest
  timing, supersets, swaps and drag-to-reorder. The live workout (with its
  rest timer) and runs show as Live Activities on the lock screen.
- **Fuel:** log food by search, barcode, saved foods and meals, manual entry,
  or an AI estimate from a description or photo. Targets come from a
  calculator and can adapt to your weight trend.
- **Progress:** workout history with past-session edits, weekly volume per
  muscle, body weight (with Apple Health sync) and WHOOP activities.
- **Runs:** GPS long runs and split sessions.
- **Widgets:** Fuel and Training on the home screen and lock screen.

## How it's built

| Part | Where | Tech |
|---|---|---|
| iPhone app | `native/` | React Native, Expo, Expo Router, TypeScript |
| Shared logic | `src/` | TypeScript and Zustand: stores, Supabase data access, nutrition and training rules |
| Widgets and Live Activities | `native/targets/widgets`, `native/modules` | SwiftUI, ActivityKit, Expo native modules |
| Backend | `supabase/` | Supabase Postgres with row-level security, Auth, Edge Functions |
| Food AI | `supabase/functions/analyze-food-trial` | Gemini, with Tavily for product research |
| Tests | `tests/` | Vitest |

The app imports the shared logic as `@/…`. The few shared modules that need a
different implementation on React Native are swapped in `native/src/platform`.

```text
native/          the iPhone app: screens (src/app), platform swaps, native modules,
                 widget and Live Activity targets, fastlane and build scripts
src/             shared logic: lib, stores, hooks, types and preview sample data
tests/           Vitest tests
supabase/        schema, migrations and Edge Functions
scripts/         ship pipeline and bot, private photo worker, evidence import, instruction checks
deploy/          systemd units for the private photo worker
docs/            current handoff and feature notes
.agents/skills/  guides for coding agents (start with AGENTS.md)
```

## Getting started

You need Node, Xcode with an iOS simulator, and CocoaPods.

```sh
npm install                # shared logic, tests and tooling
cd native && npm install   # the iPhone app
npm run ios                # in native/: build and open the app in the simulator
```

If CocoaPods fails on text encoding, run it with `LANG=en_US.UTF-8`.

Development builds start in preview mode: the app runs on sample data in
memory, so no account or backend is needed. To use a real Supabase project,
start Metro with `EXPO_PUBLIC_HYPER_PREVIEW=0`, `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_ANON_KEY`.

Release builds read the Supabase URL and public anon key from a `.env` in the
repository root (see [.env.example](.env.example)). Never commit `.env` or put
a service-role key in the app.

## Checks

Run these before opening a pull request:

```sh
npm run test                    # Vitest suite
npm run lint                    # instruction checks, ESLint, test type-check
npm run build                   # type-checks the shared code in src
cd native && npx tsc --noEmit   # the app plus the shared code it imports
```

Gestures, haptics, widgets and Live Activities still need a simulator or
device run.

## Releasing

TestFlight uploads go through `scripts/ship.sh`, which the ship bot runs: it
builds main in a clean clone, runs the checks, then archives `native/` with
fastlane as `app.hyper.mobile` and uploads it. `native/scripts/build-phone.sh`
builds a Release for a connected iPhone. Details are in
[the iOS workflow](.agents/skills/ship-ios/SKILL.md).

## Contributing

Open an issue that describes the problem, what you expected, and any
screenshots or logs. Agents and contributors working in the repository should
start with [AGENTS.md](AGENTS.md).
