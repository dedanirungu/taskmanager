#!/usr/bin/env bash
#
# Regenerates /etc/nginx/conf.d/devplatform-*.conf from DB state.
# Renders:
#   - platform.<PUBLIC_DOMAIN>           → 127.0.0.1:3000
#   - <subdomain>.<PUBLIC_DOMAIN>        → 127.0.0.1:<host_port>          (one per workspace)
#   - <name>-<subdomain>.<PUBLIC_DOMAIN> → 127.0.0.1:<preview.host_port>  (one per preview)
#
# Skips a server block if its cert is not yet issued — log a warning instead.
# After running, do:  bash scripts/issue-certs.sh <missing-domains...>  then re-run this.
#
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/devplatform}"
set -o allexport
source "$APP_DIR/.env"
set +o allexport

: "${PUBLIC_DOMAIN:?PUBLIC_DOMAIN must be set in .env}"
: "${PGPASSWORD:?PGPASSWORD must be set in .env}"
PGHOST="${PGHOST_HOST:-127.0.0.1}"
PGDATABASE="${PGDATABASE:-devplatform}"
PGUSER="${PGUSER:-devplatform}"

OUT_DIR="${OUT_DIR:-/etc/nginx/conf.d}"
TEMPLATE_DIR="$APP_DIR/nginx/conf.d"

cert_exists() {
  test -f "/etc/letsencrypt/live/$1/fullchain.pem"
}

# 1) Platform block — only substitute our placeholders; leave nginx's $host etc. alone.
PLATFORM_HOST="platform.$PUBLIC_DOMAIN"
if cert_exists "$PLATFORM_HOST"; then
  PUBLIC_DOMAIN="$PUBLIC_DOMAIN" \
    envsubst '$PUBLIC_DOMAIN' \
    < "$TEMPLATE_DIR/platform.conf.template" \
    > "$OUT_DIR/devplatform-platform.conf"
  echo "wrote devplatform-platform.conf for $PLATFORM_HOST"
else
  echo "[skip] cert missing for $PLATFORM_HOST" >&2
fi

# 2) Workspace + preview blocks (one file per workspace, includes its previews)
mapfile -t workspaces < <(PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -At -F '|' -c \
  "SELECT subdomain, host_port FROM workspaces ORDER BY subdomain")

for row in "${workspaces[@]}"; do
  sub="${row%%|*}"
  hp="${row##*|}"
  host="$sub.$PUBLIC_DOMAIN"
  out="$OUT_DIR/devplatform-ws-$sub.conf"
  : > "$out"

  if cert_exists "$host"; then
    SUBDOMAIN="$sub" PUBLIC_DOMAIN="$PUBLIC_DOMAIN" UPSTREAM="127.0.0.1:$hp" \
      envsubst '$SUBDOMAIN $PUBLIC_DOMAIN $UPSTREAM' \
      < "$TEMPLATE_DIR/workspace.conf.template" >> "$out"
    echo "wrote workspace block for $host"
  else
    echo "[skip] cert missing for $host" >&2
  fi

  # previews for this workspace
  mapfile -t previews < <(PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -At -F '|' -c \
    "SELECT p.name, p.host_port FROM workspace_previews p JOIN workspaces w ON w.id = p.workspace_id WHERE w.subdomain = '$sub'")
  for prow in "${previews[@]}"; do
    [ -z "$prow" ] && continue
    name="${prow%%|*}"
    php="${prow##*|}"
    phost="$name-$sub.$PUBLIC_DOMAIN"
    if cert_exists "$phost"; then
      NAME="$name" SUBDOMAIN="$sub" PUBLIC_DOMAIN="$PUBLIC_DOMAIN" HOST_PORT="$php" \
        envsubst '$NAME $SUBDOMAIN $PUBLIC_DOMAIN $HOST_PORT' \
        < "$TEMPLATE_DIR/preview.conf.template" >> "$out"
      echo "wrote preview block for $phost"
    else
      echo "[skip] cert missing for $phost" >&2
    fi
  done

  # If nothing got written for this workspace, remove the empty file
  [ -s "$out" ] || rm -f "$out"
done

echo "==> nginx -t && reload"
nginx -t
systemctl reload nginx
