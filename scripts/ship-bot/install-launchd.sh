#!/usr/bin/env bash
# Installs (or reinstalls) the ship-bot as a macOS LaunchAgent so it:
#   - starts automatically at login/boot (RunAtLoad)
#   - is restarted by launchd whenever it exits or crashes (KeepAlive)
#   - logs to ~/.hyper-ship/logs/ (NOT /tmp, which is wiped on reboot)
# Re-run this any time run-bot.sh or the plist changes. Idempotent.
set -euo pipefail

LABEL="app.hyper.ship-bot"
BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$HOME/.hyper-ship/logs"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$BOT_DIR/run-bot.sh</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$LOG_DIR/ship-bot.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/ship-bot.log</string>
</dict>
</plist>
PLIST

UID_NUM="$(id -u)"
launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$PLIST"
launchctl kickstart -k "gui/$UID_NUM/$LABEL"
echo "Installed $LABEL. Status:"
launchctl print "gui/$UID_NUM/$LABEL" | grep -E "state|pid" | head -3
echo "Logs: $LOG_DIR/ship-bot.log"
