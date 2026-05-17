#!/usr/bin/env bash
#
# One-shot bootstrap for a fresh Ubuntu 24.04 VPS.
# Run as root or with sudo:  bash setup-vps.sh
#
set -euo pipefail

echo "==> apt update + base packages"
apt-get update
apt-get install -y --no-install-recommends \
    curl ca-certificates gnupg lsb-release \
    git nginx certbot python3-certbot-nginx \
    build-essential ufw cron rsync jq

echo "==> Node.js 20 (for the conflict-check cron + local tools)"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "==> Docker engine + compose plugin"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable --now docker

echo "==> firewall"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> directory layout"
mkdir -p /srv/devplatform /srv/conflict-check /var/log/devplatform
chown -R "${SUDO_USER:-$USER}":"${SUDO_USER:-$USER}" /srv/devplatform /srv/conflict-check

echo
echo "==> Done. Next:"
echo "  1) Clone the platform repo into /srv/devplatform"
echo "  2) Fill in /srv/devplatform/.env (see .env.example)"
echo "  3) sudo bash scripts/issue-certs.sh <platform.yourdomain.com> [dev1.yourdomain.com ...]"
echo "  4) docker compose -f /srv/devplatform/docker-compose.platform.yml up -d --build"
echo "  5) docker build -t devplatform/code-server:latest /srv/devplatform/docker/code-server/"
echo "  6) bash scripts/install-cron.sh             # 20-min conflict checks"
echo "  7) bash scripts/install-backup-cron.sh      # nightly pg_dump + workspace rsync"
