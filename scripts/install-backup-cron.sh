#!/usr/bin/env bash
set -euo pipefail
APP_DIR="${APP_DIR:-/srv/devplatform}"
LINE="15 3 * * * $APP_DIR/scripts/backup.sh >> /var/log/devplatform/backup.log 2>&1"
EXISTING="$(crontab -l 2>/dev/null || true)"
FILTERED="$(echo "$EXISTING" | grep -v 'backup.sh' || true)"
printf '%s\n%s\n' "$FILTERED" "$LINE" | grep -v '^$' | crontab -
echo "installed:"; crontab -l | grep backup.sh || echo "(install failed)"
