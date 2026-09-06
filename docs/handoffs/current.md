# Current work snapshot

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
