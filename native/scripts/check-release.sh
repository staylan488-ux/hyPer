#!/bin/bash
# Checks a released-app archive before it goes to TestFlight:
#   native/scripts/check-release.sh <hyPer.ipa> [build-number]
# It must be app.hyper.mobile, carry the production Supabase host and no local
# test backend, and (when given) the expected build number.
set -euo pipefail

IPA="${1:?usage: check-release.sh <ipa> [build-number]}"
BUILD="${2:-}"
PROJECT_HOST="nnwfaaxmyvqsdnfcdxom.supabase.co"
GREP=/usr/bin/grep
WORK="$(mktemp -d "${TMPDIR:-/tmp}/hyper-release-check.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

unzip -q "$IPA" 'Payload/*' -d "$WORK"
APP="$(ls -d "$WORK"/Payload/*.app | head -1)"
PLIST="$APP/Info.plist"
bundle="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PLIST")"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$PLIST")"
[ "$bundle" = "app.hyper.mobile" ] || { echo "Wrong bundle ID: $bundle"; exit 1; }
[ -z "$BUILD" ] || [ "$version" = "$BUILD" ] || { echo "Build number $version, expected $BUILD"; exit 1; }
"$GREP" -a -q -F "$PROJECT_HOST" "$APP/main.jsbundle" || { echo "The bundle has no production host."; exit 1; }
if "$GREP" -a -q -E ':54321|192\.168\.|host\.docker' "$APP/main.jsbundle"; then
  echo "The bundle mentions a local test backend."
  exit 1
fi
for ext in "$APP"/PlugIns/*.appex; do
  [ -e "$ext" ] || continue
  ext_bundle="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$ext/Info.plist")"
  ext_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$ext/Info.plist")"
  case "$ext_bundle" in app.hyper.mobile.*) ;; *) echo "Wrong extension ID: $ext_bundle"; exit 1 ;; esac
  [ "$ext_version" = "$version" ] || { echo "Extension build $ext_version does not match the app's $version"; exit 1; }
done
echo "Release check passed: $bundle build $version, production host, no local backend."
