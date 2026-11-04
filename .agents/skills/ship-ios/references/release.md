# TestFlight release

[scripts/ship.sh](../../../../scripts/ship.sh) is the maintained release entrypoint.
It fetches remote main, resets an isolated build clone and continues with that
clone's copy of the script, so a stale copy elsewhere cannot ship an old
pipeline. It runs the tests, lint and the native type-check, then runs
[native/fastlane](../../../../native/fastlane/Fastfile)
to prebuild, archive, check and upload the React Native app in `native/` as
`app.hyper.mobile`. Calling it performs the upload. It does not ship
uncommitted work or the current feature branch.

For an authorized release, compare remote main's tip with the authorized release
revision and inspect the script and current non-secret configuration. A commit
being an ancestor of main does not mean this pipeline will upload that revision.
The script fetches main again at execution and does not pin an expected SHA. For
approval tied to an exact commit, use an execution path that enforces that SHA
before upload; a prior read of the branch tip is not sufficient. Resolve a changed
release target before uploading rather than silently shipping a different tip.
Its configuration and environment seed live outside the public repository;
check prerequisites without printing values. Do not change the saved checkout
to main solely to run this pipeline.

The native Fastfile chooses the latest TestFlight build number plus one, and
the version people see from the latest upload with its last digit raised by
one (2.0.4 becomes 2.0.5; [release-version.mjs](../../../../native/scripts/release-version.mjs)).
`native/app.json`'s version is the floor: to start a new line, raise it there
(to 2.1.0, say) and the next ship is 2.1.0. Both go to the prebuild and the
archive (`HYPER_BUILD_NUMBER`, `HYPER_APP_VERSION`), which give the app, its
widget extension and the app config the About screen reads the same values;
nothing is written back to the repository.
The same version and build number stamp the launch copy
([launchCache.ts](../../../../native/src/lib/launchCache.ts)), so the first
launch after each update reads the account from the network once.
`native/scripts/check-release.sh` refuses an archive with the wrong bundle or
extension IDs, mismatched build numbers or versions, no production host or a
local test backend.
On exit, worked or not, the script removes the generated `native/ios`, the IPA
and the Xcode build folder (`native/build`); the archive stays in Xcode's
Archives for crash symbols. The ship bot saves each run's output as
`~/.hyper-ship/logs/ship-<time>.log`.

If upload status is uncertain, inspect the existing submission before retrying
to avoid duplicate releases. If credentials or signing access are unavailable,
finish the local reviewable work and report the specific release prerequisite.
Successful upload and availability after App Store Connect processing are
different results; report only the state verified.

For ship-bot maintenance, inspect [the bot scripts](../../../../scripts/ship-bot/)
and its launchd installer. The maintained service owns the bot process; avoid
starting a second ad hoc instance.
