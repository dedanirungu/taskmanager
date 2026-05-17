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

# Helper to generate a wrapper script that sources .env so the cron has the
# PGHOST/PGPASSWORD/GITHUB_TOKEN/TELEGRAM_* etc. it needs.
gen_wrapper() {
  local out="$1"
  local node_script="$2"
  cat > "$out" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "$APP_DIR"
set -o allexport
source "$APP_DIR/.env"
set +o allexport
# Docker DB hostname inside the app container is "db"; from the host it's localhost.
export PGHOST="\${PGHOST_HOST:-127.0.0.1}"
exec /usr/bin/node "$APP_DIR/scripts/$node_script"
EOF
  chmod +x "$out"
}

gen_wrapper "$APP_DIR/scripts/run-conflict-check.sh"  conflict-check.js
gen_wrapper "$APP_DIR/scripts/run-pr-status-sync.sh"  pr-status-sync.js

CONFLICT_LINE="*/20 * * * * $APP_DIR/scripts/run-conflict-check.sh >> /var/log/devplatform/conflict-check.log 2>&1"
TRIGGER_LINE="* * * * * APP_DIR=$APP_DIR bash $APP_DIR/scripts/process-triggers.sh >> /var/log/devplatform/triggers.log 2>&1"
PR_SYNC_LINE="*/15 * * * * $APP_DIR/scripts/run-pr-status-sync.sh >> /var/log/devplatform/pr-sync.log 2>&1"

EXISTING="$(crontab -l 2>/dev/null || true)"
FILTERED="$(echo "$EXISTING" | grep -v -e 'run-conflict-check.sh' -e 'process-triggers.sh' -e 'run-pr-status-sync.sh' || true)"
printf '%s\n%s\n%s\n%s\n' "$FILTERED" "$CONFLICT_LINE" "$TRIGGER_LINE" "$PR_SYNC_LINE" | grep -v '^$' | crontab -

echo "Installed cron entries:"
crontab -l | grep -E 'run-conflict-check.sh|process-triggers.sh|run-pr-status-sync.sh' || echo "(install failed)"
