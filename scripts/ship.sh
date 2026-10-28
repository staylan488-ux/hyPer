#!/usr/bin/env bash
# hyPer one-command ship: pull latest main -> test -> build the native app
# (native/, React Native + Expo) as app.hyper.mobile -> archive, sign, check
# and upload to TestFlight. Runs against an ISOLATED build clone so it never
# disturbs anyone's working copy. Secrets live in ~/.hyper-ship/config.env
# (outside this PUBLIC repo). Invoked by the Discord ship bot or run directly.
# The Capacitor app (ios/) is no longer shipped from here.
set -euo pipefail

CONFIG="$HOME/.hyper-ship/config.env"
[ -f "$CONFIG" ] || { echo "FATAL: missing $CONFIG"; exit 1; }
# shellcheck source=/dev/null
source "$CONFIG"

REPO_URL="https://github.com/staylan488-ux/hyPer.git"
BUILD_REPO="${BUILD_REPO:-$HOME/.hyper-ship/build}"
ENV_SEED="$HOME/.hyper-ship/.env"

if [ ! -d "$BUILD_REPO/.git" ]; then
  echo "==> First run: cloning isolated build checkout at $BUILD_REPO"
  git clone "$REPO_URL" "$BUILD_REPO"
fi

cd "$BUILD_REPO"
echo "==> Fetching latest main"
git fetch origin --quiet
git reset --hard origin/main

# The build clone needs the prod .env (Supabase keys + photo worker URL). It is
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

# The production values the app is built with, from the same .env the web app
# used; they go into this build's environment only.
read_env() {
  grep -E "^[[:space:]]*$1[[:space:]]*=" .env | tail -1 |
    sed -E 's/^[^=]*=[[:space:]]*//; s/^"//; s/"[[:space:]]*$//; s/^'"'"'//; s/'"'"'[[:space:]]*$//'
}
EXPO_PUBLIC_SUPABASE_URL="$(read_env VITE_SUPABASE_URL)"
EXPO_PUBLIC_SUPABASE_ANON_KEY="$(read_env VITE_SUPABASE_ANON_KEY)"
EXPO_PUBLIC_PHOTO_WORKER_URL="$(read_env VITE_PHOTO_WORKER_URL || true)"
[ -n "$EXPO_PUBLIC_SUPABASE_URL" ] && [ -n "$EXPO_PUBLIC_SUPABASE_ANON_KEY" ] || { echo "FATAL: missing Supabase settings in .env"; exit 1; }
export EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_ANON_KEY EXPO_PUBLIC_PHOTO_WORKER_URL
export EXPO_PUBLIC_HYPER_PREVIEW=0 HYPER_APP=release LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

echo "==> Archiving, checking + uploading the native app to TestFlight"
cd native
fastlane beta

# Leave the clone small: the archive and the generated iOS project are rebuilt each ship.
rm -rf build ios
echo "==> Shipped."
