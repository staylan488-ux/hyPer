# Current work snapshot — Kinetic beautification pass

Recorded 2026-09-26 (Pacific). The user approved the **Kinetic / 3D-heavy**
direction in chat: keep Studio type, color and layout; make motion, data and
3D the expressive layer, and add native liquid glass (rest dock, tab bar
polish, glass toasts). The approved plan has four phases with one PR each,
and two phone-preview checkpoints (after phases 2 and 3). Merging, TestFlight
and production actions are not authorized.

- Phase 1 (`feat/kinetic-motion-foundation`, PR #124): real springs, the motion
  policy, once-per-session reveals, transform-based rails, scrubbable charts
  (weight trend, training hours, weekly nutrition, lap pace), condensing
  titles, drum time wheels. The Studio skill records the direction.
- Phase 2 (`feat/kinetic-moments`, stacked on phase 1): set-save stamp and
  beat-last chip, the movement reveal, rest bar motion, the celebratory
  completion sheet, once-a-day macro seals, the body-portalled FX canvas,
  line-art empty states and the Banked stamp.
- Next: phase 3 (lazy three.js volume maquette, 3D session token,
  motion-reactive light), then phase 4 (native glass surfaces). **Wait for
  the user's review of the phase 2 preview before phase 3.**

Verification so far: tests, lint and build pass (1063 tests). Browser
preview at 390×844 covered the charts, scrub, scroll-edge band, drum wheels,
set save and beat chip, rest in/out, completion sheet, Banked stamp, protein
seal and bursts in Black, plus Ivory spot checks. The initial JS bundle is up
about 12.5 KB gzipped over the 384 KB baseline. Physical-device haptics, frame
pacing and native iOS have not been exercised.

Phone preview: the existing tailnet-only Tailscale Serve port 8444 proxies the
dev server on 127.0.0.1:5191, which serves this checkout. Append `/preview`.

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
