# Account Holder runbook — hyPer iOS TestFlight

Steps only the Apple Account Holder (the friend who owns the Individual
Apple Developer membership) can perform. Nothing here requires sharing
the Apple password or private keys with anyone.

## 1. Verify the canonical App ID (blocks the bundle-ID flip)

The intended canonical bundle identifier is `app.hyper.mobile`. The local
branch still builds as `com.alexanderroesler.hyper` until this check is done.

1. Sign in at <https://developer.apple.com/account> → Certificates,
   Identifiers & Profiles → Identifiers.
2. Confirm whether an **explicit** App ID with identifier exactly
   `app.hyper.mobile` exists. Note its enabled capabilities.
3. If it exists, open <https://appstoreconnect.apple.com> → Apps. Confirm
   whether an app record exists and, under App Information → Bundle ID,
   that it selects `app.hyper.mobile`.
4. Report back exactly: (a) App ID exists yes/no, (b) explicit or wildcard,
   (c) App Store Connect record exists yes/no and which bundle ID it selects.
   Do NOT register a second production App ID.
5. Required capabilities on that App ID before archiving: HealthKit;
   Sign in with Apple; (Push Notifications is NOT currently required —
   rest timers use local notifications). Background Modes (location) is an
   Xcode-project setting, not an App ID capability.

## 2. After verification — capabilities and signing

1. On the Mac with the repo: open `ios/App/App.xcodeproj`, target App →
   Signing & Capabilities, choose the Account Holder's team, and let Xcode
   manage signing. The bundle ID will already be flipped to
   `app.hyper.mobile` by the pending reconciliation commit (do not flip it
   by hand in Xcode).
2. Confirm the target shows: HealthKit entitlement, Background Modes →
   Location updates, Sign in with Apple.

## 3. App Store Connect prerequisites

1. Accept any pending agreements (Agreements, Tax, and Banking).
2. Create the app record if it does not exist: platform iOS, name hyPer
   (or chosen name), primary language, bundle ID `app.hyper.mobile`,
   SKU (any stable string).
3. Invite the developer (alex) with App Manager or Developer role in App
   Store Connect → Users and Access (App Store Connect access only —
   Individual memberships cannot add Developer Program team members).

## 4. Archive and upload the acceptance build

Use a normal TestFlight-capable build (NOT "TestFlight Internal Only"):
the accepted binary may later be promoted to the release candidate.

1. `npm run ios:sync` (requires the Hyper-Dev `.env.local`; the build
   guard refuses production).
2. Xcode → Product → Archive (scheme App, Any iOS Device arm64).
3. Organizer → Distribute App → TestFlight & App Store → Upload.
4. In App Store Connect → TestFlight: create an Internal Testing group
   with the two testers' Apple IDs, enable the build for it, and fill
   What to Test from `docs/testflight-acceptance-checklist.md`.
5. Remember: each TestFlight build expires after 90 days.

## 5. Later — release phase (do NOT do now)

App Review submission, the separate Unlisted App Distribution request,
and the final release wait until the owner finishes acceptance testing
and explicitly says "GO FOR UNLISTED RELEASE". See handoff.md Rev 69
Phase 5.
