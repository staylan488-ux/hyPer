#!/usr/bin/env bash
# Generate the release project and install its native dependencies. This does
# not archive, sign or upload; it can also be used to validate ship setup locally.
set -euo pipefail

build_number="${1:?usage: prepare-release.sh BUILD_NUMBER}"
case "$build_number" in ''|*[!0-9]*) echo "FATAL: BUILD_NUMBER must be a whole number" >&2; exit 1 ;; esac
[ "${HYPER_APP:-}" = release ] || { echo "FATAL: HYPER_APP=release is required" >&2; exit 1; }
[ "${EXPO_PUBLIC_HYPER_PREVIEW:-}" = 0 ] || { echo "FATAL: EXPO_PUBLIC_HYPER_PREVIEW=0 is required" >&2; exit 1; }
export HYPER_BUILD_NUMBER="$build_number"
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

native_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$native_dir"

# Expo can report a failed pod install but still exit successfully. Run it
# separately so no archive starts with an incomplete workspace.
echo "==> Generating the release iOS project"
npx expo prebuild --platform ios --clean --no-install
cd ios
pod_log="$(mktemp "${TMPDIR:-/tmp}/hyper-pods.XXXXXX")"
trap 'rm -f "$pod_log"' EXIT

echo "==> Installing iOS pods"
if pod install 2>&1 | tee "$pod_log"; then
  pod_status=0
else
  pod_status=$?
fi

if [ "$pod_status" -ne 0 ]; then
  # Cached prebuilt pods can retain their directory/spec while losing framework
  # files. Hermes and RN core were both incomplete; the first masks the second.
  # Repair only this observed failure, once; do not retry other errors.
  if ! grep -Eq '(hermes-engine|React-Core-prebuilt)/.*\.xcframework/Info\.plist.*doesn.t exist' "$pod_log"; then
    exit "$pod_status"
  fi
  echo "==> Repairing incomplete Hermes/RN core caches and retrying iOS pods once"
  pod cache clean hermes-engine --all
  pod cache clean React-Core-prebuilt --all
  # This is the freshly generated project, not a developer's existing Pods.
  rm -rf "$native_dir/ios/Pods/hermes-engine" "$native_dir/ios/Pods/React-Core-prebuilt"
  pod install
fi

[ -f "$native_dir/ios/hyPerNative.xcworkspace/contents.xcworkspacedata" ] || {
  echo "FATAL: CocoaPods did not create hyPerNative.xcworkspace" >&2
  exit 1
}
echo "==> Selecting Release native frameworks"
"$native_dir/scripts/use-rn-core.sh" Release
