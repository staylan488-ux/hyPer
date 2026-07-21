# Account Holder runbook — hyPer iOS TestFlight

Steps only the Apple Account Holder (the friend who owns the Individual
Apple Developer membership) can perform. Nothing here requires sharing
the Apple password or private keys with anyone.

## 1. App ID — DONE (2026-07-21)

The Account Holder created the App Store Connect app record and set up the
`app.hyper.mobile` bundle identifier. The codebase has been reconciled to
`app.hyper.mobile` everywhere (commit — see handoff Rev 71) and the unsigned
Xcode build passes with it. Still worth a one-time confirmation before archiving:

- On the `app.hyper.mobile` App ID (developer.apple.com → Identifiers), these
  capabilities must be enabled or the matching features fail at runtime and in
  App Review: **HealthKit** and **Sign in with Apple**. (Push Notifications is
  NOT required — rest timers use local notifications; Background Modes →
  Location is an Xcode-project setting, not an App ID capability.)
- Hyper-Dev Supabase redirect allowlist must include the native callback (see
  section 2a) or native Google/Apple sign-in will not return to the app.

## 2. After verification — capabilities and signing

1. On the Mac with the repo: open `ios/App/App.xcodeproj`, target App →
   Signing & Capabilities, choose the Account Holder's team, and let Xcode
   manage signing. The bundle ID is already `app.hyper.mobile` in the project
   (do not change it by hand).
2. Confirm the target shows: HealthKit entitlement, Background Modes →
   Location updates, Sign in with Apple.

## 2a. Hyper-Dev Supabase native redirect allowlist (required for native sign-in)

Native Google/Apple sign-in uses ASWebAuthenticationSession and returns to the
custom scheme `app.hyper.mobile://auth/callback`. Supabase must allow it:

1. Supabase dashboard → **Hyper-Dev** project → Authentication → URL
   Configuration → **Redirect URLs**. Add: `app.hyper.mobile://auth/callback`
   (and `app.hyper.mobile://settings` if you want the WHOOP web fallback to
   accept it — the WHOOP Edge Function already allowlists it server-side).
2. This is Hyper-Dev only; production web Google OAuth (origin-based redirect)
   is untouched. Do not add these schemes to the production project unless/until
   release.

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
