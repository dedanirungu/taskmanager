#!/usr/bin/env bash
#
# Watches /srv/devplatform/triggers/ for *.req files, where the filename
# (without the .req suffix) is a hostname that needs a Let's Encrypt cert.
# For each one:
#   1. Validate the filename is a sane hostname (no shell metachars)
#   2. Run issue-certs.sh <domain>
#   3. Run render-nginx.sh (regenerates ALL conf files from DB state and reloads nginx)
#   4. Delete the trigger file
#
# Runs every minute via cron (installed by install-cron.sh).  Holds a flock
# so two concurrent runs don't fight over nginx.
#
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/devplatform}"
TRIGGERS_DIR="${TRIGGERS_DIR:-$APP_DIR/triggers}"
LOCK="/var/lock/devplatform-triggers.lock"

mkdir -p "$TRIGGERS_DIR"

# Exit silently if no triggers.
shopt -s nullglob
files=( "$TRIGGERS_DIR"/*.req )
[ ${#files[@]} -eq 0 ] && exit 0

exec 9>"$LOCK"
flock -n 9 || { echo "another trigger run in progress, skipping"; exit 0; }

processed_any=0
for f in "${files[@]}"; do
  base="$(basename "$f" .req)"
  # Whitelist: lowercase letters, digits, dashes, dots only.
  if ! [[ "$base" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]]; then
    echo "[trigger] rejecting suspicious filename: $base" >&2
    rm -f "$f"
    continue
  fi

  echo "[trigger] $(date -u +%FT%TZ) issuing cert for $base"
  if bash "$APP_DIR/scripts/issue-certs.sh" "$base" 2>&1 | tail -10; then
    rm -f "$f"
    processed_any=1
  else
    echo "[trigger] cert issuance failed for $base — leaving trigger in place for retry" >&2
  fi
done

if [ "$processed_any" -eq 1 ]; then
  echo "[trigger] regenerating nginx config"
  bash "$APP_DIR/scripts/render-nginx.sh" 2>&1 | tail -5
fi
