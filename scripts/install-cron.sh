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

CONFLICT_LINE="*/20 * * * * $WRAPPER >> /var/log/devplatform/conflict-check.log 2>&1"
TRIGGER_LINE="* * * * * APP_DIR=$APP_DIR bash $APP_DIR/scripts/process-triggers.sh >> /var/log/devplatform/triggers.log 2>&1"

EXISTING="$(crontab -l 2>/dev/null || true)"
FILTERED="$(echo "$EXISTING" | grep -v -e 'run-conflict-check.sh' -e 'process-triggers.sh' || true)"
printf '%s\n%s\n%s\n' "$FILTERED" "$CONFLICT_LINE" "$TRIGGER_LINE" | grep -v '^$' | crontab -

echo "Installed cron entries:"
crontab -l | grep -E 'run-conflict-check.sh|process-triggers.sh' || echo "(install failed)"
