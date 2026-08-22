#!/usr/bin/env bash
# Launcher for the hyPer Discord ship-bot. Used by the launchd agent
# (see install-launchd.sh) so the bot survives reboots, crashes and outages.
# launchd starts processes with a bare PATH, so we set it explicitly —
# node, git and fastlane all live in /opt/homebrew/bin.
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export HOME="${HOME:-$(eval echo ~"$(whoami)")}"
export LANG="${LANG:-en_US.UTF-8}"

CONFIG="$HOME/.hyper-ship/config.env"
[ -f "$CONFIG" ] || { echo "FATAL: missing $CONFIG"; exit 1; }
# shellcheck source=/dev/null
source "$CONFIG"

BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$BOT_DIR"
[ -d node_modules ] || npm install --no-audit --no-fund

echo "[$(date -u +%FT%TZ)] run-bot: starting ship-bot (node $(node --version))"
exec node bot.mjs
