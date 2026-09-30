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

Owner decisions (2026-09-30), all implemented in PR #134:
- Monday–Sunday training week (F24);
- the 21-day weight rate (F81);
- delete the Cronometer importer (F110);
- approve the offline sign-in change (F53).

PRs #128, #129 and #130 are merged. PR #134 (`opt/batch-b-pr`; per-finding history on `opt/batch-b`) carries:
- Batch B packages B-3, B-4, B-6/B-7, B-8, B-10, B-11, B-12, B-13 and B-14;
- the four owner decisions.

It passed 1452 tests, lint, build and the iOS build, plus a preview click-through.

Production steps, none done:
- F66 step B (delete the deployed process-food-photo function and its secrets);
- F64 tier 2 (baseline migration and repair);
- F103 (deploy analyze-food-trial);
- C-6 (per-account USDA cache migration).

PR #134 is merged. The next PR (`opt/batch-c1`) carries:
- B-5 (F1): session-based user ids, removing the auth round trip before queries.
- B-9 (F7): 30 s request limits, and 120 s for program saves.
- C-2 (F44 + F99): route splitting plus a vendor chunk. The launch load drops from about 407 to 338 KB gzip.
- C-5 (F50 step 2): the motion light runs only while lit surfaces are mounted.

Remaining: C-1 (F22), C-3 (F28) and C-4 (F41) are in progress on top of that. C-6 (F65) needs an owner-approved migration. Device checks listed in the PRs remain for the owner, notably the run tracking scenarios, the rest ring, the barcode scanner and the Health weight backlog.

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

## Photo worker models + VM re-login (2026-09-29, DEPLOYED)

User asked: re-login Codex and Claude on the VM; AI food logging (photo +
describe) on gpt-6-sol and claude-sonnet-5-5. Merged in PR #131 (b414477f).

- Worker defaults: `gpt-6-sol`, `claude-sonnet-5-5`, both `high`. The coach
  now has its own `PHOTO_WORKER_COACH_MODEL` (default `claude-opus-5`, `max`);
  before, it shared `ANTHROPIC_MODEL` and would have silently moved too.
  `/health` reports `models.coach` / `efforts.coach`.
- `gpt-6-sol` needs codex-cli >= 0.158 on a ChatGPT account. 0.146 returns
  "model is not supported when using Codex with a ChatGPT account". Verified
  on 0.158 with the worker's exact describe flags; Sonnet 5.5 verified too.
- The Gemini `analyze-food-trial` edge function is a separate trial and was
  not changed.
- Staged on the VM (md5-verified): worker + core + schemas in
  `/home/aross/hyper-deploy/scripts/`, and `/home/aross/worker-models-relogin.sh`.
  Live service still reported the old models after staging.
- The script (run interactively with sudo): upgrades the service user's
  Codex to 0.159.0 only if < 0.158; `codex login --device-auth` as
  `hyper-photo`; Claude via `setup-token` if the env file uses
  `CLAUDE_CODE_OAUTH_TOKEN`, else `claude auth login`. It real-call checks
  gpt-6-sol, sonnet-5-5 and opus-5 against a CANDIDATE env file via
  systemd-run (same user, env parser, flags). Only if all pass: back up
  `/etc/hyper/photo-worker.env`, install, wait for in-flight jobs, run
  `worker-code-deploy.sh`, assert `/health` models.
- Validation: 594/594 vitest, eslint clean, env-editing helpers harness-tested.
  Not yet exercised: the script end to end (needs sudo + the user's logins).
- Risk (recorded earlier in the root handoff): the worker serves other app
  users through personal ChatGPT/Claude subscription logins.

Deployed 2026-09-29 20:46 UTC: the user ran the script; it only installs
after all three real-call checks pass. Verified afterwards: service active,
`/health` models gpt-6-sol / claude-sonnet-5-5 / coach claude-opus-5, efforts
high / high / max, both providers authenticated, deployed worker md5 matches
b414477f. Rollback: `/etc/hyper/photo-worker.env.bak.1790714545` + restart.
