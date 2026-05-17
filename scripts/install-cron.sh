#!/usr/bin/env bash
#
# Install the 20-minute conflict-check cron entry.
# Run as the user that owns /srv/devplatform.
#
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/devplatform}"

echo "==> installing script deps in $APP_DIR/scripts"
( cd "$APP_DIR/scripts" && npm install --omit=dev --no-audit --no-fund )

mkdir -p /var/log/devplatform

# The cron entry sources .env so PGHOST/PGPASSWORD/TELEGRAM_* etc. are present.
WRAPPER="$APP_DIR/scripts/run-conflict-check.sh"
cat > "$WRAPPER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "$APP_DIR"
set -o allexport
source "$APP_DIR/.env"
set +o allexport
# When the platform is in docker, the db host is "db" on the docker network;
# from the host shell we need 127.0.0.1.
export PGHOST="\${PGHOST_HOST:-127.0.0.1}"
exec /usr/bin/node "$APP_DIR/scripts/conflict-check.js"
EOF
chmod +x "$WRAPPER"

LINE="*/20 * * * * $WRAPPER >> /var/log/devplatform/conflict-check.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'run-conflict-check.sh' ; echo "$LINE" ) | crontab -

echo "Installed cron entry:"
crontab -l | grep run-conflict-check.sh
