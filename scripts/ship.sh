#!/usr/bin/env bash
# hyPer one-command ship: pull latest main -> build web -> sync iOS -> archive,
# sign, and upload to TestFlight. Runs against an ISOLATED build clone so it
# never disturbs anyone's working copy. Secrets live in ~/.hyper-ship/config.env
# (outside this PUBLIC repo). Invoked by the Discord ship bot or run directly.
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

echo "==> Building web app"
npm install --no-audit --no-fund
npm run build

echo "==> Syncing to iOS"
npx cap sync ios

echo "==> Archiving + uploading to TestFlight"
cd ios/App
fastlane beta

echo "==> Shipped."
