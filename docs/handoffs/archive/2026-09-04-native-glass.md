# Native glass handoff — historical snapshot

Recorded from main at aba6358 before integrating the instruction cleanup on
2026-09-05. This is historical state; release authorization mentioned below is
not new authorization. PR #106 is already merged.

## Current Handoff State — native glass release

- Updated: 2026-09-04
- Branch: `codex/luminous-materials`
- Worktree: `/private/tmp/hyper-material-20260904`
- Base: `1fe8e4b` — approved Studio (#105).
- User approved the Ivory / Black diffuse materials and native glass bar, and explicitly authorized release checks, PR/merge and TestFlight upload. Release work is in progress.
- Native `HyperGlassNavigationPlugin` uses iOS 26 `UIGlassEffect`, with UIKit buttons, route/scroll synchronization and lifecycle/sheet isolation. It is now enabled automatically on native iOS; unsupported iOS and browsers retain web navigation. The prototype flag has been removed.
- Web treatment: true #000000 foundation; #303030 / #EAEAEA dark primary actions; neutral translucent surfaces and broad diffuse washes; no bevels or bright rims. Studio typography, spacing and motion retained. No auth logic, schema or dependency changes.
- Plans: `docs/plans/2026-09-04-native-glass-prototype.md` and `docs/plans/2026-09-04-luminous-materials.md`.
- Verification: 677 tests, lint and web build PASS; native Xcode build PASS. Simulator verifies both themes, native navigation and food-sheet/workout hiding. Browser verifies 320/390px layouts, food saved/manual sheets and opaque accessibility fallback. Final default-enabled simulator PASS (1 XCTest, 0 failures); production assets include the bridge and exclude the development gallery/server. Evidence: `/private/tmp/hyper-glass-ui-tests/Evidence-Release/`. Ready for PR/merge and signed upload.
- Production release uses existing `scripts/ship.sh` and the isolated signing/build checkout. Generated Capacitor config must contain no development `server.url` or cleartext setting. Signing configuration and environment files remain outside Git.
- Local preview: `http://127.0.0.1:5190/preview`; isolated simulator uses port 5191. Mock changes reset on full reload. Simulator captures are under `/private/tmp/hyper-glass-ui-tests/Evidence-Mica/`.
- Saved checkout `/Users/sinan/orca/hyPer` remains on `feat/refined-app-icon`; unrelated icon, AGENTS, gitignore and Supabase temp work is preserved and excluded from this release.
- Remaining: merge/upload, then physical iPhone validation. Further native workout/rest surfaces and App Store release are separate work.
- Next recommended command: `git diff --check` in the implementation worktree.
