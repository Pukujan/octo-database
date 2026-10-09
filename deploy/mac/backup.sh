#!/usr/bin/env bash
# Octo database backup (macOS host).
#
# Dumps the octo-db Postgres cluster to a timestamped custom-format archive and
# prunes old copies. If rclone is configured with an `r2:` remote it also copies
# the dump off the host, so a dead laptop is not a dead backup.
#
# The dump is the whole cluster (control plane, all workspaces, per-workspace
# provisioned databases), so it restores a complete Octo.
#
# Usage: ./backup.sh
# Env:
#   OCTO_BACKUP_DIR    local destination (default: $HOME/octo-backups)
#   OCTO_BACKUP_KEEP   local dumps to retain (default: 14)
#   OCTO_BACKUP_R2     rclone remote:path for offsite copy (default: r2:octo-backups)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/../gravebuster/docker-compose.yml"
BACKUP_DIR="${OCTO_BACKUP_DIR:-$HOME/octo-backups}"
KEEP="${OCTO_BACKUP_KEEP:-14}"
R2_TARGET="${OCTO_BACKUP_R2:-r2:octo-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/octo-$STAMP.dump"

mkdir -p "$BACKUP_DIR"

# -Fc is pg_restore's custom format: compressed, and restorable table-by-table.
docker compose -f "$COMPOSE_FILE" exec -T octo-db \
  pg_dump -U postgres -d postgres -Fc > "$FILE"

if [ ! -s "$FILE" ]; then
  echo "ERROR: backup file is empty: $FILE" >&2
  rm -f "$FILE"
  exit 1
fi

SIZE="$(du -h "$FILE" | cut -f1)"
echo "backup: $FILE ($SIZE)"

# Prune local dumps beyond KEEP, newest first.
ls -1t "$BACKUP_DIR"/octo-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f "$old"
  echo "pruned: $old"
done

# Offsite copy, only if rclone and the remote exist. A failure here is reported
# but does not delete the local dump.
if command -v rclone >/dev/null 2>&1 && rclone listremotes 2>/dev/null | grep -q '^r2:'; then
  if rclone copy "$FILE" "$R2_TARGET/"; then
    echo "offsite: copied to $R2_TARGET/"
  else
    echo "WARN: offsite copy to $R2_TARGET failed; local dump kept" >&2
  fi
else
  echo "offsite: skipped (rclone or r2: remote not configured)"
fi
