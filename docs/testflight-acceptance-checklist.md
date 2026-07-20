# hyPer iPhone acceptance checklist — TestFlight build (Hyper-Dev)

Run on both testers' physical iPhones against Hyper-Dev only. Mark each
item PASS / FAIL / BLOCKED. File defects with the template at the bottom.
A FAIL on any item marked [P0] blocks release; [P1] blocks unless the
owner explicitly waives it.

## A. Install and session

1. [P0] Install from TestFlight; cold-launch shows the hyPer auth screen.
2. [P0] Email/password sign-in works for both allowlisted accounts.
3. [P0] Continue with Google completes in the system sheet and returns to
   a signed-in app (no stuck browser, no production URL involved).
4. [P0] Continue with Apple signs in (first run: name/email sheet).
5. [P0] Force-quit, relaunch: session restores from Keychain without
   re-login (cold + warm).
6. [P1] Sign out returns to auth; relaunch stays signed out.
7. [P1] A non-allowlisted account cannot use the app's server features.

## B. Today / Train / program flows

8. [P0] Today shows greeting, session card, fuel summary with live data.
9. [P0] Start a workout from a program day; log sets; rest timer pill
   counts down; timer fires a local notification with the app backgrounded.
10. [P0] Complete the workout; it appears in History; editing a past
    workout's sets persists.
11. [P1] Program view/edit/delete works; volume status renders.

## C. Running (field)

12. [P0] Long Run: start outdoors, lock the phone 5+ minutes mid-run —
    distance/time keep accruing (background Core Location survives lock).
13. [P0] Splits mode: manual split by screen tap and an automatic distance
    split both record; last-split panel updates.
14. [P0] Live screen shows pace, current speed (mph), distance, time,
    avg pace, and a GPS quality badge.
15. [P0] Force-kill mid-run, relaunch: the interrupted run is restorable
    and resumes recording.
16. [P1] Auto-pause engages standing still and resumes on movement.
17. [P1] Finish screen shows splits + GPS trace quality; save is
    idempotent (retry does not duplicate); diagnostics export works.
18. [P1] Deny location permission: clear error state, no crash; grant via
    Settings recovers. Legacy sprint records remain readable.

## D. Nutrition

19. [P0] Manual food add with time/meal bucket; edit and delete a logged
    entry; totals update.
20. [P0] Saved meals: create, edit, delete, and log from Saved tab.
21. [P0] Barcode scan of a known product resolves (native VisionKit
    scanner); provenance line shows the source; logging works.
22. [P0] Barcode scan of an unknown product offers "Create a saved
    product for this barcode"; enter label macros; log it; scan the same
    code again — it now resolves from your saved foods instantly.
23. [P1] Rescanning a previously saved product works offline
    (airplane mode) from the personal catalog.
24. [P0] Photo logging: capture/pick top + side photos, review AI
    estimate, edit, save. Both providers if both are configured;
    unavailable worker shows a truthful error, not a fake result.
25. [P1] Duplicate-safe retry: resubmitting the same photo/describe
    request does not double-log (idempotency).
26. [P1] Camera permission denied: scanner and photo flows show clear
    recovery guidance.

## E. WHOOP

27. [P0] Connect WHOOP from You → consent → returns to the app connected.
28. [P0] Foreground/app-open auto-sync imports recent workouts; manual
    Sync now reports progress/result.
29. [P0] Delete an imported WHOOP activity; run Sync now: it does NOT
    reappear (tombstone holds). Also delete a GPS run that WHOOP had
    enriched; sync: no resurrected WHOOP copy.
30. [P1] Re-import is idempotent (no duplicates after repeated syncs);
    user notes on activities survive sync.

## F. Weight (Eufy → Apple Health)

31. [P0] You → Body weight → Connect: HealthKit consent appears only
    after opt-in; main-user Eufy weigh-in appears with time + source.
32. [P1] lb/kg toggle persists; history list and trend delta render; a
    manual (non-Eufy) Health sample also imports; permission-denied and
    empty states are truthful.

## G. Native/UI quality

33. [P0] No content hidden behind the home indicator or notch on either
    phone; sheets' action buttons fully tappable.
34. [P1] No horizontal overflow or clipped tabs anywhere; touch targets
    feel 44pt+; keyboard does not cover focused inputs.
35. [P1] Dark and light appearance both render correctly; Dynamic Type at
    a large accessibility size keeps screens usable; Reduce Motion stops
    page-turn/odometer animation; VoiceOver reads the main controls.
36. [P0] Airplane mode: saving shows failure/retry, never a false
    "saved"; recovery after reconnect works.

## Defect template

```
ID: (e.g. DEF-07)
Checklist item: (number)
Device / iOS: (e.g. iPhone 15 Pro, iOS 26.5)
Account: (tester 1 / tester 2)
Steps:
Expected:
Actual:
Repro rate: (always / sometimes / once)
Screenshot or screen recording: (attach)
Severity: P0 (blocks release) / P1 / P2 (cosmetic)
```

Hard stop after this checklist: report results to the owner. Release
work begins only on the owner's explicit "GO FOR UNLISTED RELEASE".
