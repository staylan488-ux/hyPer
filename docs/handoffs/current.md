# Current state

Recorded 2026-10-30 (Pacific). Finished work was cleared from this file that
day; Git history keeps the full record (this file at commit 2cd1fd2).

## Where things stand

- The released app is the React Native app in `native/`: hyPer 2.0,
  `app.hyper.mobile`. The owner approved the cutover and it was done on
  2026-10-28 (PR #152). The Capacitor shell (`ios/`) and the retired web UI
  were removed from the repository on 2026-10-30; `src/` now holds only the
  shared code the app imports. The Vercel project `hy-per` that hosted the web
  app no longer builds (`vercel.json` turns its Git deployments off); its last
  web build stays online until the project is deleted in Vercel.
- TestFlight: build 60, built from main at c175fdc on 2026-10-28, is in
  internal testing for the Team group. PR #157 (hold and drag to reorder
  movements) and PR #158 (over-target colours follow the nutrition goal) merged
  after it and are in no TestFlight build yet.
- Ship pipeline: since PR #156, `scripts/ship.sh` hands over to the build
  clone's own copy and cleans up after every run. The running bot keeps its old
  code until it is restarted with `scripts/ship-bot/install-launchd.sh` (not
  during a ship); no restart is recorded.
- The owner's iPhone has a released build from before PR #157. Install current
  main with `HYPER_APP=release native/scripts/build-phone.sh <device-id>` when
  the owner asks (the phone must be on the Mac's Wi-Fi).
- Food AI defaults to Gemini through `analyze-food-trial`. The private photo
  worker (`deploy/photo-worker`) still runs on the VM with the 2026-09-29
  models and serves only a device set to the worker.

## Open items

- PR #158 was checked with the web suite, lint, build and native `tsc`; the
  widget's Swift and the changed screens were not built or run in a simulator.
- PR #157 was checked in the simulator. Not exercised: haptics on a phone, a
  superset pair (none in the sample workout) and VoiceOver.
- `analyze-food-trial` on Hypertrophy-App (version 4) runs the live copy with
  only `serving.ts` replaced; main's `model.ts` (parallel Tavily searches) is
  undeployed. A full deploy of the function ships it, with the owner's approval.
- For the owner to confirm on the phone: sign-in carried over from the
  Capacitor app.
- For Alex, whose features these are, on a phone: WHOOP connect under the new
  identity, and saving a real GPS run (runs were saved only against a local
  test database). Also never seen on a phone: the run's sound cues and its
  lock-screen card, and the lock-screen widget sizes (built, not placed).
- Recorded for later (minor): merging 3+ activities in one step, the Target
  sets field in History, RPE below 6, Train's week strip, Progress's
  training-time detail, You's About build number, and an account deletion
  row (an App Store review need, with backend work).
- Left as is on purpose (interaction audit, 2026-10-28): logged sets in a live
  workout are corrected, not deleted (History deletes them); the Appearance
  row's whole-row menu (needs a SwiftUI row); a long press on Fuel's meal
  headers; removing an activity's start time; quick start chips' long press;
  header ⋯ menus stay silent (iOS gives them no tap callback).
