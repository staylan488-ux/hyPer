# Current state

Recorded 2026-11-13 (Pacific), at main 9211699 (through PRs #226 and #227).
Write-ups of merged branches are removed as they merge; each PR's description
and Git history keep them.

## Where things stand

- The Vercel project `hy-per` that hosted the retired web app no longer builds
  (`vercel.json` turns its Git deployments off); its last web build stays
  online until the project is deleted in Vercel. Delete `vercel.json` after
  that.
- The tracked Supabase CLI cache (`supabase/.temp`) is gone: name the project
  with `--project-ref`, or run `supabase link` again. An older checkout may
  still hold an untracked `ios/` folder from the Capacitor app; it can be
  deleted.
- Left on purpose (runtime config, change only as a planned deploy): the
  Supabase dashboard's Auth site URL and redirect list may still name the web
  app. The `.env` names keep their `VITE_` prefix. Main no longer reads the
  `capacitor:` origin or `whoop-oauth`'s `APP_BASE_URL` fallback; once main's
  functions are deployed the `APP_BASE_URL` secret is unused.
- TestFlight: the last upload recorded here is 2.0.11 build 76 (tag
  `v2.0.11`, main at efa962f, through #210) on 2026-11-09 Pacific; the Team
  group gets every build. Check App Store Connect before assuming nothing
  newer exists. Nothing merged after that tag is in TestFlight
  (`git log v2.0.11..origin/main`). #226 adds a native module
  (`@sentry/react-native`), so a phone needs a full native build, not an
  over-the-air update.
- Ship pipeline: since PR #156, `scripts/ship.sh` hands over to the build
  clone's own copy and cleans up after every run. The running bot keeps its
  old code until it is restarted with `scripts/ship-bot/install-launchd.sh`
  (not during a ship); no restart is recorded.
- A phone build of current main: `HYPER_APP=release
  native/scripts/build-phone.sh <device-id>`, when the owner asks (the phone
  must be on the Mac's Wi-Fi).
- Food AI defaults to Gemini through `analyze-food-trial`. On Hypertrophy-App
  that function is version 5 (2026-11-07, from PR #190; main has since moved
  its records to the database ledger, which is not deployed, see the next
  section): the live steps for the Analysis card (`progress: true`), per-step
  timings in `usage.stepMs`, low thinking for picking search results, and
  main's parallel Tavily searches. Older app builds are unaffected. Planner
  and finalizer stay on medium thinking until a side-by-side test on real
  meals shows low keeps the estimates. The private
  photo worker (`deploy/photo-worker`) still runs on the VM with the
  2026-09-29 models and serves only a device set to the worker.

## Production is behind main

- Live on Hypertrophy-App is `delete-account` version 1, the first version
  from PR #197 (read from the deployed source on 2026-11-09): Delete account
  works there, but removing the food analysis records is best-effort, so a
  failed cleanup can leave them behind. Main's rewrite is not deployed.
  Deploying it is a coordinated cutover, not one command: follow
  [the ledger notes](../food-analysis-ledger.md) in order. `delete-account`
  answers 503 until `FOOD_ANALYSIS_DATABASE_LEDGER_READY=true` is set, and
  main's `analyze-food-trial` answers 503 for everyone if it is deployed
  before the `food_analysis_ledger` migration is applied. Check that the Auth
  redirect list still names `app.hyper.mobile://auth/callback` (sign-up
  confirmation needs it too).
- Open sign-up (#225, migration
  `20261111120000_public_signup_hardening.sql`) is not deployed either. How
  it works and every switch: [sign-up-and-limits.md](../sign-up-and-limits.md).
  Production lacks the ledger migration, and its migration history has
  drifted from the repo, so the cutover applies the migrations by hand in the
  order in [the ledger notes](../food-analysis-ledger.md).
- The app side of the public release (#226) is merged. Still empty:
  `APP_STORE_ID` in `native/src/lib/links.ts`, until the listing exists (the
  Update hyPer button opens an App Store search until then). Crash reporting
  is off without `SENTRY_DSN` in `.env`; without `SENTRY_AUTH_TOKEN` (and
  `SENTRY_ORG`, `SENTRY_PROJECT`) the build uploads no source maps.

## Today's groups (#220) and the molten glass (#210): what is left

- The owner approved both on his phone on 2026-11-09 in the test app. Their
  rules are in the blanc-native skill (Design, and the owner's decisions).
- Today's groups, not checked with the reorder: the largest text size,
  Increase Contrast, Reduce Motion, VoiceOver's Move up and Move down. A
  heading's action is now a small glass capsule everywhere a Section has one;
  not opened: a meal's Ingredients (Add) and the program editor (Reorder).
- Left for the owner: Train still has a Start button on every other day
  (removing them changes how an off-plan day starts).
- Read in the code, not reproduced: the live workout's reorder trades places
  by a rule that assumes rows of similar height, so lifting a tall block (a
  superset) may trade it with its neighbour at once. Today's groups use a
  rule of their own (DragList's `cards`).
- The glass, not measured: what it costs over a day, and Low Power Mode on
  the phone (meant to cap it at 60). Not checked: VoiceOver.
- The glass, known and left as is: in light, a darker line passing behind
  small grey text lowers that text's contrast where they cross; during a
  swipe back the page's content hides until the slide ends; sheets' round
  close buttons are a flat fill, not glass.

## Not yet checked on a phone

Each of these passed tests and, where noted in its PR, the simulator with
sample data. None has been seen on a phone.

- Public release app changes (#226): the consent alert before anything goes
  to Gemini, the limit messages on Log food's AI tab, the Update hyPer screen,
  what an account without early access sees, About's links, and crash
  reporting once its keys exist.
- For the owner to confirm: sign-in carried over from the Capacitor app.
- For Alex, whose features these are: WHOOP connect under the new identity,
  saving a real GPS run (runs were saved only against a local test database),
  the run's sound cues and lock-screen card, and the lock-screen widget sizes
  (built, not placed).
- Design council (#186) and intro (#188): the live camera, haptics, the Live
  Activity, VoiceOver and the largest text sizes; the intro in a release
  build and after a widget launch.
- Feel (speed pass #173, design review #177): swipe, the press spring,
  drag-to-reorder and hold-to-repeat on the program editor's steppers.
- Weigh-in history (#185, #187): the real account and VoiceOver.
- Snap a meal, quick actions and App Shortcuts (#176): the Fuel reminder's
  Snap a meal button, the control in Control Center and on the Action button,
  Siri and Spotlight, the real camera, a double press, presses over a live
  workout, a sheet, the run and an open Log food, and the test and released
  apps side by side. If the control doesn't open the app, use the
  OpenIntent fallback in the design.
- Instant launch (#176), in a Debug build with `EXPO_PUBLIC_HYPER_PREVIEW=0`
  and a local test account: cold launches with the intro, Reduce Motion, a
  very bad network and airplane mode; edits made on the copy before the
  first read; kill mid-workout and reopen; sign out, then another account (no
  `hyper-launch:*` keys left); midnight, the 1st of a month and a week
  boundary; a schedule save on weak signal; preview creates no keys.
- Fuel reminder (#176): a tap cold, warm and from the offline screen; the
  permission prompt and the note when notifications are off; no banner with
  the app in front; logging enough before the time cancels it; a time zone
  and a DST change; sign-out and an expired session leave nothing pending.
  The calorie wording needs the owner's goal saved as Bulk or Lean bulk.
- Close the gap (Fuel's evening picks and the reminder naming them): the
  picks on the real account's foods, + and the tick, the review from a tap,
  the reminder's wording and its tap opening Fuel, VoiceOver and AX5.
- Accessibility (#174): every screen at AX5 and with VoiceOver, the run
  screen's live view, SwiftUI pickers' spoken names, and announcements made as
  a sheet closes. Magic Tap is wired but React Native 0.88 drops it (see the
  blanc-native skill).
- Train: haptics, VoiceOver and a superset pair for Skip and End early
  (#168, #180); a swap during a slow save, a superset with swapped roles and
  the No active program card (#183); a dropped movement's shadow (#172) and
  the 2026-10-31 fix for the hold-to-drag crash the owner hit
  (`native/src/lib/liftShadow.ts`; no crash report was read from the phone).
- Reliability (#184): the real camera, physical controls and real GPS.

## Known issues left open

- Need the owner's call because they change sign-in: sign-out offline can
  undo itself, and a launch offline with an expired token waits about 25 s.
  The unlikely ones are listed in the owner's doc "Hidden state machines in
  hyPer".
- Need a schema change: Recent shows old numbers after a saved meal is
  replaced (a replacement is a new food row with no link to the old one); a
  program edited from the launch copy before the program read lands can
  overwrite a change made on another install.
- Need a one-time data repair: products edited or deleted before the bug
  hunt (#175) may still answer scans with their old numbers.
- Unconfirmed, check on a phone first: a Fuel reminder may be planned twice
  after travelling east (`fuelReminderPlan.ts`).
- Smaller: device surfaces are cleaned only when the tabs unmount (sign-in
  flow); Health sync and run state are per device, not per account; a pull to
  refresh still running at midnight can set the account's day back until the
  next refresh; unchanged quick starts renew their launch copy only every 30
  days.
- From the design council's last review (#186), left for the owner: both
  reviewers ask to put Barcode / Manual / Photo / Describe above Recent |
  Saved in Log food (declined twice).

## For later

- Minor: merging 3+ activities in one step, the Target sets field in History,
  RPE below 6, Train's week strip, Progress's training-time detail, You's
  About build number.
- Left as is on purpose (interaction audit, 2026-10-28): logged sets in a live
  workout are corrected, not deleted (History deletes them); the Appearance
  row's whole-row menu (needs a SwiftUI row); a long press on Fuel's meal
  headers; quick start chips' long press; header ⋯ menus stay silent (iOS
  gives them no tap callback).
