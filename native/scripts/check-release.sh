#!/bin/bash
# Checks a released-app archive before it goes to TestFlight:
#   native/scripts/check-release.sh <hyPer.ipa> [build-number] [version]
# It must be app.hyper.mobile, carry the production Supabase host and no local
# test backend, and (when given) the expected build number and version. Its
# extensions and the app config the About screen reads must carry the app's
# version too.
set -euo pipefail

IPA="${1:?usage: check-release.sh <ipa> [build-number] [version]}"
BUILD="${2:-}"
VERSION="${3:-}"
PROJECT_HOST="nnwfaaxmyvqsdnfcdxom.supabase.co"
GREP=/usr/bin/grep
PLIST_BUDDY="${PLIST_BUDDY:-/usr/libexec/PlistBuddy}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/hyper-release-check.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

plist_value() { "$PLIST_BUDDY" -c "Print :$1" "$2"; }

unzip -q "$IPA" 'Payload/*' -d "$WORK"
APP="$(ls -d "$WORK"/Payload/*.app | head -1)"
PLIST="$APP/Info.plist"
bundle="$(plist_value CFBundleIdentifier "$PLIST")"
build="$(plist_value CFBundleVersion "$PLIST")"
version="$(plist_value CFBundleShortVersionString "$PLIST")"
[ "$bundle" = "app.hyper.mobile" ] || { echo "Wrong bundle ID: $bundle"; exit 1; }
[ -z "$BUILD" ] || [ "$build" = "$BUILD" ] || { echo "Build number $build, expected $BUILD"; exit 1; }
[ -z "$VERSION" ] || [ "$version" = "$VERSION" ] || { echo "Version $version, expected $VERSION"; exit 1; }
"$GREP" -a -q -F "$PROJECT_HOST" "$APP/main.jsbundle" || { echo "The bundle has no production host."; exit 1; }
if "$GREP" -a -q -E ':54321|192\.168\.|host\.docker' "$APP/main.jsbundle"; then
  echo "The bundle mentions a local test backend."
  exit 1
fi
# The About screen shows the version from the app config Xcode embedded while
# archiving, which follows the archive's environment rather than Info.plist.
app_config="$(find "$APP" -path '*/EXConstants.bundle/app.config' | head -1)"
[ -n "$app_config" ] || { echo "The archive has no embedded app config (EXConstants.bundle/app.config)."; exit 1; }
config_version="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version ?? ""))' "$app_config")"
[ "$config_version" = "$version" ] || { echo "The embedded app config says version $config_version, the app $version"; exit 1; }
for ext in "$APP"/PlugIns/*.appex; do
  [ -e "$ext" ] || continue
  ext_bundle="$(plist_value CFBundleIdentifier "$ext/Info.plist")"
  ext_build="$(plist_value CFBundleVersion "$ext/Info.plist")"
  ext_version="$(plist_value CFBundleShortVersionString "$ext/Info.plist")"
  case "$ext_bundle" in app.hyper.mobile.*) ;; *) echo "Wrong extension ID: $ext_bundle"; exit 1 ;; esac
  [ "$ext_build" = "$build" ] || { echo "Extension build $ext_build does not match the app's $build"; exit 1; }
  [ "$ext_version" = "$version" ] || { echo "Extension version $ext_version does not match the app's $version"; exit 1; }
done
echo "Release check passed: $bundle $version build $build, production host, no local backend."
