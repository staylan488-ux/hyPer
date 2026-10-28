#!/bin/bash
# Puts the prebuilt React Native core and Hermes engine for a build
# configuration in place. Run before xcodebuild whenever the configuration
# changes (Debug <-> Release) and after `pod install`:
#   native/scripts/use-rn-core.sh Debug
#
# React Native swaps both inside the build, after Xcode has already copied the
# previous ones, and treats a missing marker as Debug without swapping (pod
# install removes the markers). A Debug build after a Release one can then fail
# to link (undefined facebook::react::Sealable) or crash at launch (missing
# hermes cdp symbols).
set -euo pipefail

config="${1:?usage: use-rn-core.sh Debug|Release}"
case "$config" in Debug) other=Release ;; Release) other=Debug ;; *) echo "Debug or Release" >&2; exit 1 ;; esac

native_dir="$(cd "$(dirname "$0")/.." && pwd)"
pods="$native_dir/ios/Pods"
rn="$native_dir/node_modules/react-native"
rn_version="$(node -p "require('$rn/package.json').version")"
hermes_tarball="$(ls "$pods/hermes-engine-artifacts/" | grep -i -- "-$(echo "$config" | tr '[:upper:]' '[:lower:]').tar.gz$" | head -1)"
hermes_version="$(echo "$hermes_tarball" | sed -E 's/^hermes-ios-(.*)-(debug|release)\.tar\.gz$/\1/')"

cd "$pods"
# Mark the other configuration so each script really swaps.
echo "$other" > React-Core-prebuilt/.last_build_configuration
node "$rn/scripts/replace-rncore-version.js" -c "$config" -r "$rn_version" -p "$pods"
mkdir -p hermes-engine
echo "$other" > hermes-engine/.last_build_configuration
node "$rn/sdks/hermes-engine/utils/replace_hermes_version.js" -c "$config" -r "$hermes_version" -p "$pods"

# Expo's precompiled modules swap the same way, with lowercase markers.
lower="$(echo "$config" | tr '[:upper:]' '[:lower:]')"
lower_other="$(echo "$other" | tr '[:upper:]' '[:lower:]')"
expo_modules=()
for tarball in */artifacts/*-"$lower".tar.gz; do
  [ -e "$tarball" ] || continue
  module_dir="${tarball%%/*}"
  module="$(basename "$tarball" "-$lower.tar.gz")"
  echo "$lower_other" > "$module_dir/artifacts/.last_build_configuration"
  node "$native_dir/node_modules/expo-modules-autolinking/scripts/ios/replace-xcframework.js" -c "$lower" -m "$module" -x "$pods/$module_dir"
  expo_modules+=("$module_dir/$module.xcframework")
done

# The tarballs keep their original dates; new ones make Xcode copy them again.
find React-Core-prebuilt/React.xcframework hermes-engine "${expo_modules[@]}" -exec touch {} +
