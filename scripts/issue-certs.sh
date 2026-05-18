#!/usr/bin/env bash
#
# Issue Let's Encrypt certs for the platform subdomain and any dev subdomains.
# Usage:  sudo bash scripts/issue-certs.sh platform.example.com dev1.example.com dev2.example.com
#
# Reads CERTBOT_EMAIL from /srv/devplatform/.env so you don't need to pass it
# on the command line each time.
#
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <domain> [<domain> ...]" >&2
  exit 1
fi

ENV_FILE="${APP_DIR:-/srv/devplatform}/.env"
if [ -f "$ENV_FILE" ] && [ -z "${CERTBOT_EMAIL:-}" ]; then
  CERTBOT_EMAIL="$(grep -E '^CERTBOT_EMAIL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
fi
EMAIL="${CERTBOT_EMAIL:-admin@$(hostname -d 2>/dev/null || echo example.com)}"

for DOMAIN in "$@"; do
  echo "==> issuing cert for $DOMAIN"
  # certonly --nginx uses the running nginx to handle the HTTP-01 challenge
  # but does NOT try to modify nginx conf files.  We render those ourselves
  # via render-nginx.sh — having certbot also try to edit them would fail
  # whenever a fresh subdomain has no pre-existing server block.
  certbot certonly --nginx \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    --keep-until-expiring \
    -d "$DOMAIN"
done
echo "==> renewal timer:"
systemctl list-timers certbot.timer --no-pager || true
