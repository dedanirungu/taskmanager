#!/usr/bin/env bash
#
# Daily backup: pg_dump + workspace rsync snapshot.
# Run via cron, e.g.:
#   15 3 * * * /srv/devplatform/scripts/backup.sh >> /var/log/devplatform/backup.log 2>&1
#
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/devplatform}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"

source "$APP_DIR/.env"

mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/workspaces"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

echo "==> [$STAMP] pg_dump"
docker exec devplatform-db pg_dump -U "${PGUSER:-devplatform}" "${PGDATABASE:-devplatform}" \
  | gzip > "$BACKUP_DIR/db/$STAMP.sql.gz"

echo "==> [$STAMP] workspaces rsync snapshot"
# Exclude IDE state and node_modules / venvs to keep snapshots small.
rsync -a --delete \
  --exclude='*/node_modules' \
  --exclude='*/.venv' \
  --exclude='*/.config/code-server/logs' \
  --exclude='*/.config/code-server/heapSnapshot.*' \
  "$APP_DIR/workspaces/" "$BACKUP_DIR/workspaces/latest/"

# Snapshot the latest into a dated tarball weekly (Sundays) only, to control disk usage.
if [ "$(date -u +%u)" = "7" ]; then
  tar -C "$BACKUP_DIR/workspaces" -czf "$BACKUP_DIR/workspaces/$STAMP.tar.gz" latest
fi

echo "==> retention: deleting dumps older than ${RETAIN_DAYS}d"
find "$BACKUP_DIR/db" -name '*.sql.gz' -mtime "+$RETAIN_DAYS" -delete || true
find "$BACKUP_DIR/workspaces" -maxdepth 1 -name '*.tar.gz' -mtime "+$((RETAIN_DAYS * 2))" -delete || true

echo "==> done"
