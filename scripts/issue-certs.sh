#!/usr/bin/env bash
#
# Issue Let's Encrypt certs for the platform subdomain and any dev subdomains.
# Usage:  sudo bash scripts/issue-certs.sh platform.example.com dev1.example.com dev2.example.com
#
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <domain> [<domain> ...]" >&2
  exit 1
fi

EMAIL="${CERTBOT_EMAIL:-admin@$(hostname -d 2>/dev/null || echo example.com)}"

for DOMAIN in "$@"; do
  echo "==> issuing cert for $DOMAIN"
  certbot --nginx \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    --redirect \
    -d "$DOMAIN"
done

systemctl reload nginx
echo "==> renewal timer:"
systemctl list-timers certbot.timer --no-pager || true
