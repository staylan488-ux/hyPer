# Simplification review against the latest app

Reviewed 2026-09-05 against `origin/main` at `aba6358`, including PRs #106,
#107 and #108. The first pass mistakenly started from `1fe8e4b` in the saved
checkout. The latest main was integrated locally and both nutrition and
training were reassessed before preparing the PR.

## Changes retained after reassessment

- Remove readiness labels derived only from weekly set volume. They duplicate
  the volume rails and do not measure recovery, elapsed time or WHOOP data.
- Remove consecutive-day training and nutrition streaks. Training streaks
  penalize scheduled rest; nutrition streaks use an arbitrary tolerance and a
  seven-day query window. This deletes calculated indicators, not saved data.
- Retain the seven-day calorie/protein chart with current-target guides,
  consistent scaling, and explicit loading, empty and failure states.
- Save the full nutrition entry once instead of retrying progressively smaller
  payloads that omit time, destination or source. Surface failure and preserve
  the form. Keep hosted-trial retry IDs and upsert behavior to prevent duplicate
  diary rows; editing an existing entry still takes priority.
- Replace the two intro implementations with the approved shared P-to-hyPer
  animation. It settles into the real masthead, respects reduced motion and
  session playback, supports interruption, and hides native glass navigation
  only while the intro is present.

## Latest work preserved

The Ivory/Black palette, diffuse materials, shared controls, native glass plugin,
workouts, programs, history, stores and scheduling remain intact. The hosted
Gemini/Tavily trial, estimate-first behavior, one-question limit, evidence
labeling, analysis retry protection and private-worker option also remain.
The private worker still supports existing analysis and the coach.

All 62 files changed only by the newer main, excluding the intentionally adapted
native navigation hook, matched main byte for byte after integration. Overlap
files were reviewed separately: app routing, auth presentation, Dashboard,
Progress, FoodLogger and project guidance. Other recent implementation
worktrees were inspected without alteration; no open feature PR was found.

No further deletions were justified in this pass. In particular, collapsing the
latest food-analysis pipeline would remove useful behavior rather than simplify
it. Existing icon and instruction work is included at the user's request.

## Verification and limits

- 821 tests in 73 files passed; lint, instruction checks and production web
  build passed. Focused regressions cover complete saves, retry IDs, update
  priority, intro cancellation and native-navigation visibility markers.
- Capacitor sync and the integrated Xcode simulator build passed (unsigned,
  generic iOS Simulator destination).
- Browser preview verifies the intro using current theme controls and styles.
- Production schema, paid model calls and physical-device behavior were not
  exercised. No backend deployment or TestFlight release is part of this work.
