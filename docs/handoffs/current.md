# Current state

Recorded 2026-11-07 (Pacific), at main b3f61df (through PR #188). Write-ups
of merged branches were removed that day; each PR's description and Git
history keep them (this file at commit b3f61df has the long version).

## Where things stand

- The released app is the React Native app in `native/`: hyPer 2.0,
  `app.hyper.mobile`, which replaced the Capacitor app on 2026-10-28
  (PR #152). The Capacitor shell (`ios/`) and the web UI were removed on
  2026-10-30; `src/` holds only the shared code the app imports. The Vercel
  project `hy-per` that hosted the web app no longer builds (`vercel.json`
  turns its Git deployments off); its last web build stays online until the
  project is deleted in Vercel. Delete `vercel.json` after that.
- 2026-11-07 repo refresh (branch `claude/laughing-brown-2eg222`): the
  Capacitor packages, shims and web-only code left in `src/` were removed and
  the docs brought up to date, with no change to the app. The tracked
  Supabase CLI cache (`supabase/.temp`) is gone: name the project with
  `--project-ref`, or run `supabase link` again. An older checkout may still
  hold an untracked `ios/` folder from the Capacitor app; it can be deleted.
- Left on purpose (runtime config, change only as a planned deploy): the
  `analyze-food-trial` gateway still accepts a `capacitor:` origin, which the
  function's `FOOD_ANALYSIS_ALLOWED_ORIGINS` secret may name; `whoop-oauth`
  still falls back to `APP_BASE_URL/settings` (the web app) when no return
  address is sent, though the app always sends `app.hyper.mobile://settings`.
  The Supabase dashboard's Auth site URL and redirect list may still name the
  web app. The `.env` names keep their `VITE_` prefix.
- Merged since the last TestFlight upload recorded here: #181–#190, among
  them the full weigh-in history (#185), the design council's Blanc
  refinements with a custom camera (`expo-camera`, #186) and a quicker launch
  intro (#188) and the Analysis card's live steps (#190, shipped to
  TestFlight on 2026-11-07). #186 adds a native module, so a phone needs a
  full native build, not an over-the-air update.
- TestFlight: the last upload recorded here is 2.0.3 build 68 (main at
  24ba2fe, through #180) on 2026-11-04 Pacific; the Team group gets every
  build. Check App Store Connect before assuming nothing newer exists.
- Ship pipeline: since PR #156, `scripts/ship.sh` hands over to the build
  clone's own copy and cleans up after every run. The running bot keeps its
  old code until it is restarted with `scripts/ship-bot/install-launchd.sh`
  (not during a ship); no restart is recorded.
- A phone build of current main: `HYPER_APP=release
  native/scripts/build-phone.sh <device-id>`, when the owner asks (the phone
  must be on the Mac's Wi-Fi).
- Food AI defaults to Gemini through `analyze-food-trial`. On Hypertrophy-App
  that function is version 5 (2026-11-07, from PR #190; main has since moved
  its records to the database ledger, which is not deployed, see Account
  deletion below): the live steps for the Analysis card (`progress: true`), per-step
  timings in `usage.stepMs`, low thinking for picking search results, and
  main's parallel Tavily searches. Older app builds are unaffected. Planner
  and finalizer stay on medium thinking until a side-by-side test on real
  meals shows low keeps the estimates. The private
  photo worker (`deploy/photo-worker`) still runs on the VM with the
  2026-09-29 models and serves only a device set to the worker.

## Account deletion and forgot password (branch `claude/project-thread-a2w5po`)

- You › Account has Delete account (one confirm), backed by the new
  `delete-account` Edge Function: it removes the account's food analysis
  ledger files, deletes the auth user (every table's rows go with it: they
  all cascade from `auth.users` through `profiles`), then tells WHOOP, so a
  deletion that fails leaves WHOOP connected. Sign-in has
  Forgot password?: the reset link returns to `<scheme>://auth/callback`
  (the URL email confirmation already uses), signs in on this phone and shows
  the New password screen (`native/src/app/new-password.tsx`) before the app.
- Not deployed; until then Delete account says it couldn't delete. Deploying
  it is a coordinated cutover, not one command: follow
  [the ledger notes](../food-analysis-ledger.md) in order. `delete-account`
  answers 503 until `FOOD_ANALYSIS_DATABASE_LEDGER_READY=true` is set, and
  main's `analyze-food-trial` answers 503 for everyone if it is deployed
  before the `food_analysis_ledger` migration is applied. Check that the Auth
  redirect list still names `app.hyper.mobile://auth/callback` (sign-up
  confirmation needs it too).
- Not done: revoking the Sign in with Apple token on deletion (needs the
  Apple key and the provider refresh token, which Supabase doesn't keep).

## Today's groups, and holding one to move it (branch `t3/native-ui-clutter-review`)

- The rules are in the blanc-native skill (Design, and the owner's
  decisions): a page grouped by space, bold for headings only, a glass
  capsule for whatever is pressed, and Today cut to training, Fuel and
  Progress. Train and Fuel follow the same spacing and weights.
- Holding a group on Today brings glass cards in behind all three; it is
  dragged into place and the cards fade. The order is kept on the phone, per
  account, and does not sync. The owner approved it on his phone on
  2026-11-09 in the test app.
- A heading's action is now a small glass capsule everywhere a Section has
  one. Seen: Today and You. Not opened: a meal's Ingredients (Add) and the
  program editor (Reorder).
- Checked in the simulator: Today, Train and Fuel in dark and light; Today
  and Fuel at the largest text size and Today with Increase Contrast, before
  the reorder was added. Not checked with the reorder: the largest text size,
  Increase Contrast, Reduce Motion, VoiceOver's Move up and Move down.
- Left for the owner: Train still has a Start button on every other day
  (removing them changes how an off-plan day starts).
- Read in the code, not reproduced: the live workout's reorder trades places
  by a rule that assumes rows of similar height, so lifting a tall block (a
  superset) may trade it with its neighbour at once. Today's groups use a
  rule of their own (DragList's `cards`).

## Molten glass and the card-less pages (merged, PR #210)

- The look and its rules are in the blanc-native skill (Design). The owner
  judged it on his phone on 2026-11-09 in the test app: the first build (a
  field per tab, 30 to 60 fps, full strength) was rejected as laggy and
  distracting; the rewrite (one shared field at 120 fps, the "faint" level)
  was approved.
- It adds a native module (`native/modules/hyper-glass-field`), so a phone
  needs a full native build, not an over-the-air update.
- Checked in the simulator: every screen in dark and light, the largest text
  size, Increase Contrast, Reduce Motion, swipe back, leaving and returning.
  Measured on the phone: 120 fps with no late frames over 40 s, about 1.2 ms
  of GPU a frame.
- Battery: the glass draws at 120 fps only while the app is being used; 15 s
  after the last touch, scroll, press or tab change it fades away and stops
  drawing on the bare page, and any use fades it back in. Not measured: what the remaining cost is over a day, and Low
  Power Mode on the phone (meant to cap it at 60). Not checked: VoiceOver.
- Known and left as is: in light, a darker line passing behind small grey
  text lowers that text's contrast where they cross; during a swipe back the
  page's content hides until the slide ends; sheets' round close buttons are a
  flat fill, not glass.
- Also in the branch, unrelated to glass: SwiftUI pickers ignore the safe
  area (a segmented picker used to stick under a sheet's header and overlap
  the text below while scrolling).

## Not yet checked on a phone

Each of these passed tests and, where noted in its PR, the simulator with
sample data. None has been seen on a phone.

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
