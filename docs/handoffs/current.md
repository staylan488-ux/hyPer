# Current work snapshot — optimization pass

Recorded 2026-09-26 (Pacific). The owner asked for a thorough optimization review that loses no quality or feature usability. The read-only multi-agent review is recorded in [the optimization review](../audits/2026-09-26-optimization-review.md): 98 confirmed findings, each with a safety guard.

The owner said "go" for Batch A plus the two data-loss packages. Each was implemented in its own worktree lane, independently reviewed and fixed, then integrated:
- `opt/batch-a` (Batch A):
  - the safety net (A1);
  - cleanup (A2);
  - the small fixes (A3), except the ones waiting on a decision.
- `opt/whoop-sync` (B-1, G1/G4/G13/G14). It conflicts with Batch A only in `tests/appStore.mustWork.test.ts`, where tests are appended.
- `opt/run-tracking` (B-2, F72/F8/F9/F57/F10/F56). It merges cleanly with Batch A.

The combined state of all three passed:
- 1247 tests;
- lint, including the new test type-check;
- the web build;
- the iOS simulator build.

A preview click-through covered Today, set save and rest, finish, food logging with time, History, Coaching, Program, Run, You and Saved meals, in Ivory and Black, with no console errors. Fonts are now self-hosted, with no Google requests.

Held for owner decisions:
- F24 (Monday training week);
- F81 (21- or 30-day weight rate);
- F110 (delete or restore the Cronometer importer);
- F53 (offline cold start with an expired login, an auth-flow change).

Production steps, none done:
- F66 step B (delete the deployed process-food-photo function and its secrets);
- F64 tier 2 (baseline migration and repair);
- F103 (deploy analyze-food-trial);
- C-6 (per-account USDA cache migration).

Next: Batch B packages B-3 to B-14 and Batch C, per the plan. Device checks listed in the PRs remain for the owner, notably the run tracking scenarios, the rest ring, the barcode scanner and the Health weight backlog.

# Previous work snapshot — Kinetic beautification pass

Recorded 2026-09-26 (Pacific). All four Kinetic phases shipped as PRs #124–#127 (merged): motion foundation and charts, workout and nutrition moments, lazy three.js maquette and session token, and native iOS 26 glass surfaces. Physical-device feel (glass, haptics, motion light, VoiceOver) is still for the owner to check on TestFlight.

# Previous work snapshot — adaptive scheduling setting

Recorded 2026-09-05 (Pacific). Implemented locally on
`codex/adaptive-scheduling-toggle`, based on freshly fetched upstream `f026eeb`
(PR #112, current You settings). The former `3735/hyPer` worktree was removed;
this task uses an isolated clone at `/private/tmp/hyPer-adaptive-setting-20260905`.
The saved main checkout and its unrelated `supabase/.temp/linked-project.json`
were left untouched. After reviewing the implementation and account-wide
persistence, the user explicitly authorized a GitHub PR and merge in this
session. A separate production change or iOS release was not requested.

You → Training (within the existing Activity directory) now has one standard
“Adaptive split scheduling” switch and short explanatory text. No duplicate
Train/dashboard control or new dashboard card. Missing settings on existing/new
accounts default on. Successful changes are saved to the existing account user
metadata and persisted session; no schema migration or auth-flow changes. Failed
saves retain the previous value and show an error; delayed saves cannot overwrite
another account's local state.

Today and Train share the reactive preference. On retains existing completed-day
anchoring. Off uses the original saved fixed calendar, with no completion-read
dependency; flexible mode still advances by eligible completion counts in saved
order, including compatibility with legacy offsets. Re-enabling immediately
returns to the existing adaptive history projection. Workouts and saved splits
are never rewritten by the switch. The preview backend now echoes and retains
mock account metadata across reloads; workout fixtures continue to reset.

Verification: 890 tests across 76 files passed, including 26 new toggle cases and
an actual Supabase SDK persisted-session restoration test; lint/instruction
checks and production build/TypeScript passed. Tests used non-secret localhost
Supabase placeholders because this isolated checkout has no .env. Existing
large-bundle/Browserslist warnings remain. Independent final review found no
actionable issues.

Bundled Playwright browser verification at 390×844 covered Ivory/Black, default-on,
off/on after reload, failed saves retaining their confirmed value, and identical
Today/Train changes (saved Lower A when off; adaptive Lower B when re-enabled from
completed Upper B). No page errors or horizontal overflow. Test fixtures stayed
in the isolated preview browser; no source fixtures or real account data changed.
Screenshots: `/private/tmp/adaptive-toggle-ivory-on.png` and
`/private/tmp/adaptive-toggle-black-off.png`.

Native/device appearance and real-service persistence were not exercised; the
SDK persistence regression uses a mocked auth server with real session storage
behavior. Account metadata uses the existing session refresh behavior on other
devices. No local cache is used as a substitute for a successful account save.

Next: check the GitHub PR for `codex/adaptive-scheduling-toggle`. PR creation
and merge are authorized for this setting; native device validation remains pending.
