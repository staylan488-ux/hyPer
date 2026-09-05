# Native validation

Run commands from the repository root. The available scripts are in
[package.json](../../../../package.json); native configuration is in
[capacitor.config.ts](../../../../capacitor.config.ts).

For a web change that needs native validation, `npm run ios:sync` builds the web
app and syncs it to iOS; `npm run ios:open` opens Xcode. For a source build check:

```sh
xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -quiet build
```

Production runtime requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
at web build time; `.env` is one supported source of those values, not a required
filename. Confirm presence without printing values. The dev `/preview` uses
fixtures; passing a build alone does not establish configured runtime behavior.

Review sync-generated changes in `ios/App/App/public` and `project.pbxproj`;
keep unrelated generated churn and existing user changes out of the task.

## Native contracts

- [RestActivityPlugin.swift](../../../../ios/App/App/RestActivityPlugin.swift)
  contains `HyperViewController` plugin registration. `WorkoutActivityAttributes`
  must match its mirror in
  [HyperWidgetsLiveActivity.swift](../../../../ios/App/HyperWidgets/HyperWidgetsLiveActivity.swift).
- Native OAuth implementation lives in [nativeAuth.ts](../../../../src/lib/nativeAuth.ts)
  and [HyperAuthPlugin.swift](../../../../ios/App/App/HyperAuthPlugin.swift).
  When auth changes are explicitly requested, validate the native callback flow
  before release. Preserve auth during unrelated work.
- Physical-device checks remain necessary for system keyboard, status bar,
  camera/scanner, haptics, and Live Activity behavior affected by the change.

## App icon

If this checkout contains `scripts/generate-app-icon.mjs` and
`assets/README.md`, follow that README and run
`node scripts/generate-app-icon.mjs` for a requested icon export. It writes only
the master PNG and iOS app icon from the outlined SVG and preserves splash assets.

The exporter belongs to the refined-icon change and may be absent on an older
checkout. If either file is absent, report that prerequisite clearly and resolve
the intended checkout before exporting; do not substitute full asset regeneration.
Check matching opaque 1024×1024 outputs and inspect the result visually. iOS adds
its own icon effects, so report on-device appearance as unverified until observed.
