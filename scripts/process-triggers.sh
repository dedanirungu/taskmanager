#!/usr/bin/env bash
#
# Trigger watcher for cert + nginx automation.
# Runs every minute via cron (installed by install-cron.sh).  Two file types:
#
#   <domain>.req  → issue a Let's Encrypt cert for <domain>, then re-render nginx
#   <domain>.del  → revoke + delete the cert, drop the nginx conf, re-render
#
# Filenames are whitelisted to a hostname pattern; anything else is rejected.
# A flock prevents two cron ticks from fighting over nginx.
#
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/devplatform}"
TRIGGERS_DIR="${TRIGGERS_DIR:-$APP_DIR/triggers}"
LOCK="/var/lock/devplatform-triggers.lock"

mkdir -p "$TRIGGERS_DIR"

shopt -s nullglob
req_files=( "$TRIGGERS_DIR"/*.req )
del_files=( "$TRIGGERS_DIR"/*.del )
[ ${#req_files[@]} -eq 0 ] && [ ${#del_files[@]} -eq 0 ] && exit 0

exec 9>"$LOCK"
flock -n 9 || { echo "another trigger run in progress, skipping"; exit 0; }

valid_host() {
  [[ "$1" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]]
}

processed_any=0

for f in "${req_files[@]}"; do
  base="$(basename "$f" .req)"
  if ! valid_host "$base"; then
    echo "[trigger] rejecting suspicious .req filename: $base" >&2
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

for f in "${del_files[@]}"; do
  base="$(basename "$f" .del)"
  if ! valid_host "$base"; then
    echo "[trigger] rejecting suspicious .del filename: $base" >&2
    rm -f "$f"
    continue
  fi

  echo "[trigger] $(date -u +%FT%TZ) deleting cert + nginx conf for $base"
  # certbot delete is idempotent — succeeds even if the cert doesn't exist.
  certbot delete --cert-name "$base" --non-interactive 2>&1 | tail -5 || true
  # Drop any standalone server block files we still have for this host.
  for conf in /etc/nginx/conf.d/devplatform-*.conf; do
    [ -f "$conf" ] || continue
    if grep -q "server_name $base;" "$conf"; then
      rm -f "$conf"
      echo "[trigger] removed $conf"
    fi
  done
  rm -f "$f"
  processed_any=1
done

if [ "$processed_any" -eq 1 ]; then
  echo "[trigger] regenerating nginx config"
  bash "$APP_DIR/scripts/render-nginx.sh" 2>&1 | tail -5
fi
