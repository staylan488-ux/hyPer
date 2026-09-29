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
- The user reviewed the phase 2 preview ("Looks good") on 2026-09-26.
- Phase 3 (`feat/kinetic-3d`, stacked on phase 2): three.js in a lazy chunk.
  - A volume maquette (porcelain/obsidian mannequin with 14 shaded muscle
    regions) on Coaching, plus a still figurine on Today's insight.
  - A lacquer-enamel session token in the completion sheet.
  - Motion light on floating glass and the token (deviceorientation where
    it needs no prompt, otherwise scroll).
  - Flat fallbacks without WebGL.
- The user approved phase 3 ("Go for it") on 2026-09-26.
- Phase 4 (`feat/kinetic-native-glass`, stacked on phase 3):
  - A SwiftUI iOS 26 glass rest dock: rolling Fraunces countdown, a progress
    ring around the pause control, Skip/Continue morphing via
    GlassEffectContainer.
  - Native glass toasts.
  - Tab bar polish: Geist, 22pt radius, animated materialise/dematerialise.
  - A CoreMotion attitude stream feeding the motion light.
  - Fonts: the user approved downloading Geist Medium and Fraunces 72pt
    Light (OFL) from Google Fonts into `public/fonts/native`.
  - Verified in the iOS 26.5 simulator via `/preview/glass` in light and dark
    (running, warning, completed, toast, tab bar).
  - Physical-device feel, VoiceOver and real workout flows on device are
    not yet exercised.

Verification so far: tests, lint and build pass (1074 tests). Browser
preview at 390×844 covered the charts, scrub, scroll-edge band, drum wheels,
set save and beat chip, rest in/out, completion sheet, Banked stamp, protein
seal and bursts in Black, plus Ivory spot checks. The initial JS bundle is up
about 18 KB gzipped over the 384 KB baseline. three.js ships in its own
lazy 133 KB-gzip chunk. The hidden browser pane never fires
IntersectionObserver, so the 3D scenes were rendered with a manual harness
there. On devices they load as they approach the viewport. Physical-device haptics, frame
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

## Photo worker models + VM re-login (2026-09-29, awaiting user VM step)

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

Next: user runs `sudo bash /home/aross/worker-models-relogin.sh` on the VM,
then confirm `/health` shows gpt-6-sol / claude-sonnet-5-5 / coach opus-5.
Rollback: restore `/etc/hyper/photo-worker.env.bak.<ts>` and restart.
