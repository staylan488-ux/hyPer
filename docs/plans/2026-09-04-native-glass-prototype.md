# Native Liquid Glass navigation

## Approved release scope

Native bottom navigation uses Apple’s iOS 26 `UIGlassEffect(.regular)` over the existing Capacitor content. It is enabled automatically on native iOS; the capability handshake keeps web navigation on older iOS, in browsers, or when the bridge is unavailable. The user authorized release checks, PR/merge and TestFlight upload on September 4, 2026.

The approved Studio typography and page composition remain intact. The web layer uses the Ivory / true Black diffuse material treatment described in `2026-09-04-luminous-materials.md`. Native conversion of the workout/rest dock is a later step, after physical-device review.

## Implementation

- `HyperGlassNavigationPlugin.swift` provides a native capsule with UIKit buttons and SF Symbols. It is registered in `HyperViewController` and included in the App target.
- The bridge routes native selections through the existing React router and saves the outgoing route’s scroll position. Selection is acknowledged by the router.
- Increasing revisions and visibility generations reject stale asynchronous work. Capability revision seeding supports WebView reloads that outlive the plugin.
- Native keyboard/app lifecycle observers and web inert/visibility state suppress navigation during sheets, workouts, keyboard use and backgrounding. UIKit presentations cover the host overlay; tab callbacks also refuse routing under presentations.
- Full-document navigation invalidates desired visibility and queued updates until the new document explicitly synchronizes. Auth/navigation delegates are not replaced.
- No authentication, database schema, business-store or dependency changes.

## Verification

- 63 test files / 677 tests pass, including native bridge fallback, stale responses, disposal, reload revisions and route scroll capture.
- Lint and production web build pass, with existing bundle-size and Browserslist warnings.
- Native source compiles with Xcode 26.6. The iOS 26.5 simulator verifies Today/Fuel/You selection, both appearances, sheet hiding/restoration and workout hiding. Dark Resume and Save set labels remain readable.
- Browser review covers 320/390px layouts, food sheets/manual entry, true-black foundation and the opaque increased-contrast fallback.
- Final default-enabled simulator run and TestFlight upload are recorded in the current AGENTS.md handoff.

## Production packaging

Use the existing `scripts/ship.sh` workflow after merging the reviewed commit. It builds from main in an isolated checkout, syncs bundled production assets into iOS, selects the next App Store Connect build number, signs/archives and uploads via the existing Fastlane lane.

No prototype environment flag is required. Verify generated Capacitor configuration has no `server.url` or cleartext development setting. The simulator development server and mock preview must never be shipped. Private signing configuration and environment files remain outside Git.

TestFlight distribution is authorized. App Store review, public/unlisted release and further native surface conversion are separate work. Physical iPhone touch, animation, keyboard and accessibility validation are the next review step.
