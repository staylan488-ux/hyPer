#!/usr/bin/env bash
# hyPer one-command ship: pull latest main -> test -> build the native app
# (native/, React Native + Expo) as app.hyper.mobile -> archive, sign, check
# and upload to TestFlight. Runs against an ISOLATED build clone so it never
# disturbs anyone's working copy. Secrets live in ~/.hyper-ship/config.env
# (outside this PUBLIC repo). Invoked by the Discord ship bot or run directly.
set -euo pipefail

CONFIG="$HOME/.hyper-ship/config.env"
[ -f "$CONFIG" ] || { echo "FATAL: missing $CONFIG"; exit 1; }
# shellcheck source=/dev/null
source "$CONFIG"

REPO_URL="https://github.com/staylan488-ux/hyPer.git"
BUILD_REPO="${BUILD_REPO:-$HOME/.hyper-ship/build}"
ENV_SEED="$HOME/.hyper-ship/.env"

if [ "${HYPER_SHIP_FROM_MAIN:-}" != 1 ]; then
  if [ ! -d "$BUILD_REPO/.git" ]; then
    echo "==> First run: cloning isolated build checkout at $BUILD_REPO"
    git clone "$REPO_URL" "$BUILD_REPO"
  fi

  cd "$BUILD_REPO"
  echo "==> Fetching latest main"
  git fetch origin --quiet
  git reset --hard origin/main

  # Carry on with main's own copy of this script, not the one that was called:
  # the bot calls a copy in a checkout that can be days behind main, and on
  # 2026-10-28 such a copy shipped the retired Capacitor app as build 59.
  HYPER_SHIP_FROM_MAIN=1 exec bash "$BUILD_REPO/scripts/ship.sh" "$@"
fi

cd "$BUILD_REPO"
echo "==> Building main at $(git rev-parse --short HEAD)"

# Leave the clone small whether the ship works or not: the generated iOS
# project, the IPA and the Xcode build folder are made again on every ship.
# The archive stays in Xcode's Archives folder for crash symbols.
trap 'rm -rf "$BUILD_REPO/native/build" "$BUILD_REPO/native/ios"' EXIT

# The build clone needs the prod .env (Supabase keys, crash reporting). It is
# gitignored so it survives reset --hard, but seed/refresh it from the stash.
[ -f "$ENV_SEED" ] && cp "$ENV_SEED" "$BUILD_REPO/.env"

echo "==> Installing locked dependencies"
npm ci --no-audit --no-fund
(cd native && npm ci --no-audit --no-fund)

# Gate: a failing test, lint error or native type error stops the ship before
# anything reaches TestFlight (set -e). eslint only, so a docs/instruction slip
# can't block it.
echo "==> Running tests, lint and the native type-check (ship aborts on failure)"
npm run test
npx eslint .
(cd native && npx tsc --noEmit)

# The production values the app is built with, from the repository's .env (its
# VITE_* names are kept from the retired web app); they go into this build's
# environment only.
read_env() {
  grep -E "^[[:space:]]*$1[[:space:]]*=" .env | tail -1 |
    sed -E 's/^[^=]*=[[:space:]]*//; s/^"//; s/"[[:space:]]*$//; s/^'"'"'//; s/'"'"'[[:space:]]*$//'
}
EXPO_PUBLIC_SUPABASE_URL="$(read_env VITE_SUPABASE_URL)"
EXPO_PUBLIC_SUPABASE_ANON_KEY="$(read_env VITE_SUPABASE_ANON_KEY)"
[ -n "$EXPO_PUBLIC_SUPABASE_URL" ] && [ -n "$EXPO_PUBLIC_SUPABASE_ANON_KEY" ] || { echo "FATAL: missing Supabase settings in .env"; exit 1; }
export EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_ANON_KEY
# Store builds carry no private Mac worker address: the early accounts that use
# one keep it in their account settings (You › Food analysis › Mac worker).
unset EXPO_PUBLIC_PHOTO_WORKER_URL
# Crash reporting (Sentry), all optional: without SENTRY_DSN the app reports
# nothing; without SENTRY_AUTH_TOKEN the build uploads no source maps.
EXPO_PUBLIC_SENTRY_DSN="$(read_env SENTRY_DSN || true)"
SENTRY_AUTH_TOKEN="$(read_env SENTRY_AUTH_TOKEN || true)"
SENTRY_ORG="$(read_env SENTRY_ORG || true)"
SENTRY_PROJECT="$(read_env SENTRY_PROJECT || true)"
export EXPO_PUBLIC_SENTRY_DSN SENTRY_AUTH_TOKEN SENTRY_ORG SENTRY_PROJECT
export EXPO_PUBLIC_HYPER_PREVIEW=0 HYPER_APP=release LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

echo "==> Archiving, checking + uploading the native app to TestFlight"
cd native
fastlane beta
echo "==> Shipped."
