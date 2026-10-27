#!/bin/bash
# Builds hyPer Native for the owner's iPhone against the real account
# (production Supabase), checks the bundle, and with a device id installs and
# opens it. Ask the owner before installing.
#   native/scripts/build-phone.sh                # build and check only
#   native/scripts/build-phone.sh <device-id>    # then install and open
# `xcrun devicectl list devices` shows the device id.
#
# The Supabase URL and anon key come from the web app's .env (in the main
# checkout, which worktrees share) and go only into this build's environment;
# nothing is printed or written to the repo. Run
# `npx expo prebuild --platform ios --clean` in native/ first if ios/ is missing
# or the native setup changed. The Release frameworks stay in place afterwards:
# run `scripts/use-rn-core.sh Debug` before the next simulator build.
#
# Overrides: HYPER_ENV_FILE (another .env), HYPER_DERIVED_DATA (build folder).
set -euo pipefail

NATIVE="$(cd "$(dirname "$0")/.." && pwd)"
DEVICE="${1:-}"
MAIN_CHECKOUT="$(dirname "$(git -C "$NATIVE" rev-parse --path-format=absolute --git-common-dir)")"
ENV_FILE="${HYPER_ENV_FILE:-$MAIN_CHECKOUT/.env}"
DD="${HYPER_DERIVED_DATA:-${TMPDIR:-/tmp}/hyper-native-phone}"
LOG="$DD/build-phone.log"
PROJECT_HOST="nnwfaaxmyvqsdnfcdxom.supabase.co"
GREP=/usr/bin/grep

[ -f "$ENV_FILE" ] || { echo "No .env at $ENV_FILE (set HYPER_ENV_FILE)."; exit 1; }
[ -d "$NATIVE/ios/hyPerNative.xcworkspace" ] || {
  echo "No iOS project: run npx expo prebuild --platform ios --clean in native/."
  exit 1
}

read_env() {
  "$GREP" -E "^[[:space:]]*$1[[:space:]]*=" "$ENV_FILE" | tail -1 |
    sed -E 's/^[^=]*=[[:space:]]*//; s/^"//; s/"[[:space:]]*$//; s/^'"'"'//; s/'"'"'[[:space:]]*$//'
}
url="$(read_env VITE_SUPABASE_URL)"
key="$(read_env VITE_SUPABASE_ANON_KEY)"
[ -n "$url" ] && [ -n "$key" ] || { echo "Missing Supabase settings in $ENV_FILE."; exit 1; }
case "$url" in
  "https://$PROJECT_HOST"*) ;;
  *) echo "The .env points at an unexpected Supabase project."; exit 1 ;;
esac
team="$(node -p 'require(process.argv[1]).expo.ios.appleTeamId' "$NATIVE/app.json")"

mkdir -p "$DD"
"$NATIVE/scripts/use-rn-core.sh" Release > /dev/null
rm -rf "$DD/Build/Products/Release-iphoneos/XCFrameworkIntermediates"
echo "Building Release for the phone (log: $LOG)..."
if ! (
  cd "$NATIVE/ios" &&
    EXPO_PUBLIC_HYPER_PREVIEW=0 EXPO_PUBLIC_SUPABASE_URL="$url" EXPO_PUBLIC_SUPABASE_ANON_KEY="$key" LANG=en_US.UTF-8 \
      xcodebuild -workspace hyPerNative.xcworkspace -scheme hyPerNative -configuration Release \
      -destination 'generic/platform=iOS' -derivedDataPath "$DD" -allowProvisioningUpdates \
      DEVELOPMENT_TEAM="$team" build > "$LOG" 2>&1
); then
  "$GREP" -E 'error:' "$LOG" | sort -u | head -20
  echo "Build failed; see $LOG."
  exit 1
fi

APP="$DD/Build/Products/Release-iphoneos/hyPerNative.app"
BUNDLE="$APP/main.jsbundle"
# The bundle must point at production and carry no local test backend.
"$GREP" -a -q -F "$PROJECT_HOST" "$BUNDLE" || { echo "The bundle has no production host."; exit 1; }
if "$GREP" -a -q -E ':54321|192\.168\.|host\.docker' "$BUNDLE"; then
  echo "The bundle mentions a local test backend."
  exit 1
fi
echo "Built $APP (production host present, no local test backend)."

[ -n "$DEVICE" ] || exit 0
xcrun devicectl device install app --device "$DEVICE" "$APP" > /dev/null
echo "Installed on $DEVICE."
if xcrun devicectl device process launch --device "$DEVICE" --terminate-existing app.hyper.native > /dev/null 2>&1; then
  echo "Opened on the phone."
else
  echo "Installed, but iOS refused to open it (usually a locked phone). Open it on the phone."
fi
