# Current work snapshot — adaptive scheduling setting

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

# Previous work snapshot — You simplification

Recorded 2026-09-05 (Pacific). Current task: approved YOU-screen simplification,
implemented locally on `codex/simplify-you`, based on latest-main commit `9d14193`.
The user reviewed and approved the private phone preview, then explicitly
authorized PR creation and merge. Production deployment and an iOS release
remain separate actions and were not requested.

The screen is now a compact directory with weight entry, nutrition targets,
saved meals, analysis setup, connections, appearance, account and About.
All existing capabilities are retained. Long tasks have `/settings/*` routes;
React Router's data router supports unsaved-draft blocking for Back/tab changes.
The Settings subtree stays mounted across its detail routes to preserve drafts.
Calculator profile/weight saves and later adaptive effects remain separate from
saving target drafts and are disclosed explicitly.

Preview entry: `/preview/you` (populated), or append `?youState=empty`.
The private phone URL was delivered in the conversation. Tailnet-only Tailscale Serve port 8444 proxies
127.0.0.1:5191. Existing port 8443 was preserved. The dev server runs detached;
its PID is recorded in `/tmp/hyper-you-preview.pid`, log in
`/tmp/hyper-you-preview.log`. Keep it running for the user's review. Preview
records reset on reload; theme/method preferences may remain on that origin.
Coach/worker/usage actions in the normal preview do not call real providers.
Native Apple Health, real WHOOP OAuth, physical-device haptics and VoiceOver
were not verified by this web preview.

See [the implementation review](../audits/2026-09-05-you-ux-preview.md) for
verification and limitations. Final checks: 864 tests, lint and build passed;
independent implementation review scored 8.6/10. This snapshot records the
approved implementation before publication; check the PR state before resuming.
Preserve unrelated `supabase/.temp/linked-project.json`. Earlier handoffs below
are historical and do not grant additional release authorization.

# Previous work snapshot

Recorded 2026-09-05. The saved checkout integrated latest main `aba6358`
(PRs #106–108) in `871a0b1` on `feat/refined-app-icon`; the earlier local work was
committed as `ae9036e`. [PR #109](https://github.com/staylan488-ux/hyPer/pull/109)
contains this batch; check its current merge status before resuming. The user
requested a PR and merge containing the icon, instruction
cleanup, app simplification and approved brand animation. Their subsequent
concern about the stale starting point prompted a fresh latest-main audit before
publication. See [the reassessment](../audits/2026-09-05-latest-app-simplification.md).

The latest Ivory/Black materials, native glass navigation and hosted
Gemini/Tavily estimate-first meal analysis are preserved. Retained changes are
the removal of misleading readiness/streak indicators, complete nutrition
saves with existing trial retry IDs, the weekly chart, and the shared intro.
The Studio skill now reflects the newer approved materials. The newer main's
embedded handoff is preserved in the [native glass archive](archive/2026-09-04-native-glass.md).

Integrated checks: 821 tests passed, lint/instruction checks passed, production
web build passed, Capacitor sync passed, and the unsigned Xcode simulator
build passed. Physical-device appearance/behavior and production
food-analysis calls remain unverified. No new backend or TestFlight release is
authorized by the local audit. Preserve unrelated `supabase/.temp/linked-project.json`.

## Earlier snapshot

Recorded 2026-09-04. Read when resuming work; confirm current git state before
acting. This file records state, not fresh authorization to merge or release.

- Checkout branch at recording: feat/refined-app-icon; HEAD 1fe8e4b, approved
  Studio implementation merged through PR #105. Adaptive calendar #104 and the
  set-save recovery fix are already in this base.
- Approved icon work remains uncommitted in this checkout: the elegant paper/red
  P, centered on its visible outline, with matching opaque 1024×1024 PNGs. Its
  assets/README.md and scripts/generate-app-icon.mjs explain the dedicated export.
  The heavier rounded concept was rejected. Preserve the icon files and exporter.
- Icon verification previously passed: 668 tests, lint, build, pixel/opacity/size
  and centering checks, and Xcode asset-catalog compilation. A new native build
  and physical-device appearance validation remain pending; no release was
  performed by the instruction cleanup.
- Instruction cleanup replaces obsolete FOLIO rules with Studio guidance, shares
  skills through .agents/skills and Claude aliases, narrows verification, and
  archives previous handoffs. See [maintenance](../agent-workflows.md) for the
  current structure and check command.
- Cleanup verification passed: 679 tests, lint, build, three skill validations,
  clean-snapshot integrity and fresh Codex discovery. The [resolution record](../audits/2026-09-04-instruction-cleanup.md)
  distinguishes local fixes from remaining vendor source issues. Project changes
  remain uncommitted; global preferences are installed in their normal locations.
- Preserve unrelated supabase/.temp/linked-project.json and the original local
  ignore-rule intent. The .gitignore additions now make only shared instruction
  adapters and the three skill aliases eligible for version control.
- Next work depends on the user's request: review the instruction changes
  separately from the unfinished icon work; merge or release only within the
  active conversation's authorization.

Earlier detailed history is in the [archived snapshot](archive/2026-09-04-before-instruction-cleanup.md).
