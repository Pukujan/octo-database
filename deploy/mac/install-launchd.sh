#!/usr/bin/env bash
# Install Octo's macOS LaunchAgents (autodeploy poller + nightly database backup).
#
# Replaces the systemd units used on the Linux host (deploy/gravebuster/systemd/).
# Run as the owning user; no sudo needed. Agents run while the user is logged in
# (launchd user domain). Docker Desktop must be running for either to succeed.
#
# Usage:
#   ./install-launchd.sh          install and load both agents
#   ./install-launchd.sh uninstall  unload and remove both agents

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
AGENTS_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs"
PATH_VAL="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

AUTODEPLOY_LABEL="com.octo.autodeploy"
BACKUP_LABEL="com.octo.backup"
AUTODEPLOY_PLIST="$AGENTS_DIR/$AUTODEPLOY_LABEL.plist"
BACKUP_PLIST="$AGENTS_DIR/$BACKUP_LABEL.plist"

mkdir -p "$AGENTS_DIR" "$LOG_DIR"

unload() {
  for plist in "$AUTODEPLOY_PLIST" "$BACKUP_PLIST"; do
    if [ -f "$plist" ]; then
      launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
      rm -f "$plist"
      echo "removed: $plist"
    fi
  done
}

if [ "${1:-install}" = "uninstall" ]; then
  unload
  echo "Octo LaunchAgents uninstalled."
  exit 0
fi

unload

cat > "$AUTODEPLOY_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$AUTODEPLOY_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$REPO_DIR/deploy/gravebuster/autodeploy.sh</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO_DIR</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$PATH_VAL</string></dict>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG_DIR/octo-autodeploy.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/octo-autodeploy.log</string>
</dict>
</plist>
PLIST

cat > "$BACKUP_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$BACKUP_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$REPO_DIR/deploy/mac/backup.sh</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO_DIR</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$PATH_VAL</string></dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$LOG_DIR/octo-backup.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/octo-backup.log</string>
</dict>
</plist>
PLIST

for plist in "$AUTODEPLOY_PLIST" "$BACKUP_PLIST"; do
  launchctl bootstrap "gui/$(id -u)" "$plist"
  echo "loaded: $plist"
done

echo
echo "Octo LaunchAgents installed."
echo "  autodeploy: every 300s, log $LOG_DIR/octo-autodeploy.log"
echo "  backup:     daily 03:30, log $LOG_DIR/octo-backup.log"
