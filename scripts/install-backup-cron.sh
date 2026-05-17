#!/usr/bin/env bash
set -euo pipefail
APP_DIR="${APP_DIR:-/srv/devplatform}"
LINE="15 3 * * * $APP_DIR/scripts/backup.sh >> /var/log/devplatform/backup.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'backup.sh' ; echo "$LINE" ) | crontab -
echo "installed:"; crontab -l | grep backup.sh
