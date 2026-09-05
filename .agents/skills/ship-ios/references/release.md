# TestFlight release

[scripts/ship.sh](../../../../scripts/ship.sh) is the maintained release entrypoint.
It fetches remote main, resets an isolated build clone, builds and syncs the web
app, then runs fastlane to archive and upload. Calling it performs the upload.
It does not ship uncommitted work or the current feature branch.

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

[Fastfile](../../../../ios/App/fastlane/Fastfile) chooses the latest TestFlight
build number plus one and updates every `CURRENT_PROJECT_VERSION` in the build
clone. App and widget versions must match. Do not copy this generated build-number
diff into an unrelated feature commit.

If upload status is uncertain, inspect the existing submission before retrying
to avoid duplicate releases. If credentials or signing access are unavailable,
finish the local reviewable work and report the specific release prerequisite.
Successful upload and availability after App Store Connect processing are
different results; report only the state verified.

For ship-bot maintenance, inspect [the bot scripts](../../../../scripts/ship-bot/)
and its launchd installer. The maintained service owns the bot process; avoid
starting a second ad hoc instance.
