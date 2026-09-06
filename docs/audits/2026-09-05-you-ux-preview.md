# YOU UX implementation and phone preview

Recorded September 5, 2026 (Pacific). Approved implementation on
`codex/simplify-you`, based on latest-main commit `9d14193`. The user reviewed
and approved the private phone preview and subsequently authorized a PR and
merge. This report records the implementation before publication. Production
deployment and an iOS release are outside this request.

## Result

YOU is now a directory of named destinations, with direct weight entry and
compact saved-state summaries. At 390 × 844, the populated landing view measured
1,143px of scroll content, compared with 2,793px for the earlier relatively empty
screen. This demonstrates reduced landing-page density; it is not a controlled
usability comparison or evidence that every task is faster.

The existing Studio typography, colors, materials and four-tab navigation are
preserved. Essential actions use more readable text, destination rows are fully
tappable, and settings sheets have a more opaque reading surface. The page
preserves saved values separately from drafts.

## Retained features

- Body weight: manual entry, unit choice/conversion, latest date/source, recent
  entries, smoothed trend/rate, and native Apple Health setup/sync/stop-sync.
- Nutrition: all four daily target fields, calculator units/stats/composition/
  activity/goal/rate/review/notes, coach goal and sharing choice, rationale and
  cautions, manual saving, expenditure explanation and adaptive resume.
- Meals: list/count, editing/save/cancel, deletion confirmation, past-log
  preservation, load feedback and retry.
- Analysis: both hosted and Mac methods, hosted usage, worker URL, both photo
  providers, save/test and connection diagnostics. The coach has a direct worker
  setup link independent of meal-analysis method.
- Connections: WHOOP status and sync date, connect/sync/disconnect and callback
  result handling. The existing run shortcut remains on YOU.
- Personal settings: display name, Ivory/Black appearance and confirmed sign-out.
- About: brand, build stamp, research colophon and tappable haptic test.

## Important interaction details

The calculator saves profile information and may record changed weight before
staging targets. Copy explains that target numbers still need Save and that
saved profile/weight can affect a later adaptive update. Discarding target drafts
does not pretend to undo those earlier saves. Partial weight/profile or saved-
meal retirement failures receive explicit feedback.

Calculator and coach results ask before replacing edited target drafts. Users
can keep their draft and revisit the proposed values. Dirty drafts are protected
on task departure, browser Back and tab navigation. Setup/help child routes keep
related drafts; leaving worker setup discards only that task's draft when the
user requests it. Sign-out separately discloses unsaved edits.

React Router uses its data-router API to support the blocker. The same route
layout and authentication conditions remain, and the Settings subtree stays
mounted across detail paths. Existing route scroll restoration still runs per
pathname; originating rows use stable focus keys. Calculator step changes focus
the next heading without animated scrolling.

## Verification

Final application checks passed:

- `npm run test`: 864 tests in 75 files.
- `npm run lint`: includes instruction checks, no warnings/errors from ESLint.
- `npm run build`: production build passed.
- `git diff --check`: passed.

Added tests cover the Settings draft-departure matrix and truthful target-mode
labels, plus populated/empty preview fixture behavior and mock write retention.
The build retains advisory messages about chunk size and old Browserslist data;
these did not prevent the build.

Browser checks used the actual local app and Tailscale HTTPS endpoint:

- Populated and empty YOU views; 390px Ivory and Black appearance; 320px narrow
  layout with no horizontal overflow; 430px calculator/new-account flow.
- One-tap weight sheet, entered kg→lb conversion and saved weight feedback.
- Saved-target overview remains unchanged while a draft is edited; explicit
  Save updates it. New accounts can save unchanged starting defaults.
- Coach prerequisite messaging, sample suggestions, replacement confirmation,
  Keep current draft, retained suggestion review and rationale/cautions.
- All six calculator steps, optional composition skip, profile save→target
  draft, and disclosure when abandoning a resulting target draft.
- Saved-meal edits, meal-to-meal replacement guard, browser Back guard,
  Keep editing, successful save and originating-row focus restoration.
- Hosted analysis selection/usage, worker access in hosted mode, labeled
  provider, normalized worker save and clean Back without false dirty warning.
- Private Tailscale entry link resolves to the populated YOU screen.

Limitations: this is a web preview with mock records. Real WHOOP authorization,
Apple Health permissions/sync, physical-device haptics, native glass integration,
VoiceOver and OS large-text settings were not exercised. Error UI and native-only
paths received source review, not exhaustive live fault injection. No
representative-user study has been completed. These remain release checks;
passing web tests does not certify native or production service behavior.

## Phone preview

Populated preview entry: `/preview/you`. Empty-account entry:
`/preview/you?youState=empty`. The private phone URL was delivered in the
conversation.

The Mac must remain online and the phone connected to the same Tailscale
network. Tailscale Serve is tailnet-only on port 8444, forwarding to the detached
Vite server at 127.0.0.1:5191. The existing 8443 service was preserved. No public
Funnel was enabled. Preview record edits reset on reload; appearance/method
preferences may remain on the preview origin. Standard preview coach/worker/
usage actions do not contact real providers. `/sandbox` is a different existing
workflow and is not the link supplied for this review.

Process record: `/tmp/hyper-you-preview.pid`; log:
`/tmp/hyper-you-preview.log`. Stop only this preview's Serve endpoint when the
user is done: `tailscale serve --https=8444 off`. Do not reset all Serve routes.

## Review status

The independent reviewer rated the final implementation **8.6/10**, with no
remaining blockers to the private phone preview. They confirmed the feature map
is preserved and earlier findings were corrected: meal draft replacement, focus
restoration, sign-out draft disclosure/busy protection, unchanged-default saving,
normalized worker drafts, weight-unit conversion, and accessible feedback.
Native navigation, VoiceOver, OS large text, Health/OAuth/haptics and broader
failure-state testing remain release checks. The user approved the phone
preview and authorized PR creation and merge after this review.
