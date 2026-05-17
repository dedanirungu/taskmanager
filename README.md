# Developer Platform

Self-hosted task-board + browser-VS-Code (code-server) workspaces so contractors
can work on your client repos through Claude Code, without ever downloading the codebase.

See [`plan.md`](./plan.md) for the full design doc.  This README is the *operator's* guide.

---

## What's in here

```
.
├── plan.md                          ← the design doc
├── docker-compose.platform.yml      ← runs the control plane (Node app + Postgres)
├── docker-compose.workspaces.yml    ← example shape for per-developer containers
├── .env.example                     ← required env vars
│
├── app/                             ← the platform (Node.js + React)
│   ├── Dockerfile                   ← builds the platform image
│   ├── package.json
│   ├── db/migrations/               ← raw SQL migrations, applied in lexical order
│   ├── src/
│   │   ├── server.js                ← Fastify entry point
│   │   ├── db/{pool,migrate,seed-admin}.js
│   │   ├── middleware/auth.js
│   │   ├── routes/{auth,admin,tasks,me}.js
│   │   └── services/{github,docker,telegram,audit}.js
│   └── frontend/                    ← Vite + React SPA, built into app/frontend/dist
│
├── docker/code-server/              ← the per-developer IDE image
│   ├── Dockerfile                   ← code-server + Claude Code + git baked in
│   └── entrypoint.sh
│
├── nginx/conf.d/                    ← *.template files; substitute and drop into /etc/nginx/conf.d
├── scripts/
│   ├── setup-vps.sh                 ← bootstrap a fresh Ubuntu 24.04 box
│   ├── issue-certs.sh               ← certbot --nginx for each subdomain
│   ├── conflict-check.js            ← runs every 20 min, alerts via Telegram
│   ├── pr-status-sync.js            ← marks tasks merged when PR is merged
│   ├── backup.sh                    ← daily pg_dump + workspace rsync
│   ├── install-cron.sh              ← installs the conflict-check cron
│   └── install-backup-cron.sh
├── systemd/devplatform.service      ← optional: run the platform as a systemd unit
└── workspaces/                      ← runtime data; per-developer mounts (excluded from git)
```

---

## Quick start (production VPS)

### 0. Manual prerequisites (Claude can't do these)

| Task | How |
|---|---|
| Provision a VPS | Hetzner CCX13 / CX42 (Ubuntu 24.04), 16 GB RAM, 4 vCPU, 80 GB SSD |
| Buy a domain | Any registrar |
| DNS A records | `platform.yourdomain.com` + `dev1.yourdomain.com … dev5.yourdomain.com` → VPS IP |
| GitHub PAT | Fine-grained PAT scoped to your 5 client repos: Contents read/write, PRs read/write, Metadata read |
| Telegram bot | Talk to `@BotFather`, then hit `getUpdates` to find your chat id |

### 1. Bootstrap the VPS

```bash
ssh root@your-vps
git clone <this-repo> /srv/devplatform
cd /srv/devplatform
sudo bash scripts/setup-vps.sh
```

That installs Docker, Node 20, nginx, certbot, ufw.

### 2. Configure secrets

```bash
cp .env.example .env
$EDITOR .env       # fill in the secrets
```

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### 3. Bring up the platform

```bash
sudo bash scripts/issue-certs.sh platform.yourdomain.com
docker compose -f docker-compose.platform.yml up -d --build
```

Migrations run automatically on container start.  Seed the first admin:

```bash
docker exec -it devplatform-app sh -c "ADMIN_USERNAME=dedan ADMIN_PASSWORD='choose-a-strong-password' ADMIN_EMAIL=you@example.com node src/db/seed-admin.js"
```

Now hit `https://platform.yourdomain.com` and sign in.

### 4. Wire up the nginx proxy for the platform

Render the platform template and drop it in (one-time):

```bash
PUBLIC_DOMAIN=yourdomain.com envsubst < nginx/conf.d/platform.conf.template \
  | sudo tee /etc/nginx/conf.d/platform.conf >/dev/null
sudo nginx -t && sudo systemctl reload nginx
```

For each developer workspace you create (next step), do the same with
`workspace.conf.template`, setting `SUBDOMAIN`, `PUBLIC_DOMAIN`, and
`UPSTREAM=<containerName>:8080`, and issue a cert for that subdomain.

### 5. Build the code-server image

```bash
docker build -t devplatform/code-server:latest docker/code-server/
```

### 6. Create projects + developers in the UI

1. **Projects** → add each client repo (`owner/name` on GitHub).
2. **Users** → create each developer; set scope to `scoped` and check their projects.
3. **Workspaces** → click "Provision workspace" for each developer.
   This boots their container, writes the IDE password (visible to admin and to that developer
   in their `/workspace` page), and joins it to the docker network.
4. For each new workspace subdomain, render the nginx template and issue the cert
   (`scripts/issue-certs.sh dev1.yourdomain.com`).

### 7. Schedule the crons

```bash
sudo bash scripts/install-cron.sh         # every 20 min: conflict-check
sudo bash scripts/install-backup-cron.sh  # nightly:    pg_dump + rsync
# Optional:
sudo crontab -e
# add:  */15 * * * * cd /srv/devplatform && /usr/bin/node scripts/pr-status-sync.js >> /var/log/devplatform/pr-sync.log 2>&1
```

---

## Day-to-day flows

### You: create a task
- Sign in → **Task board** → **+ New task** → pick project + write title/description.

### Developer: claim and work
- Signs in → **Task board** → **Claim** on an open task in their scope.
- Platform creates the branch inside their container and opens the workspace URL in a new tab.
- They sign in to code-server with the password shown on **My workspace**.
- Run `claude` in the integrated terminal → authorize their own Claude Pro account on first run.

### Developer: submit
- **Submit** on the task → platform commits + pushes via your GitHub PAT.
- You get a Telegram alert with a "Open PR" link.

### You: open PR + merge
- Open the PR on GitHub manually.
- Paste the PR URL into the task on the platform (it flips to `awaiting_review`).
- After you merge on GitHub, `pr-status-sync.js` flips it to `merged` within ~15 min
  (or you can click **Mark merged** in the UI).

### Conflict detection
- Every 20 min, `conflict-check.js` fetches each project into a bare clone under
  `/srv/conflict-check/<slug>.git`, then `git merge-tree`s each pair of active task branches.
- First conflict between a pair → one Telegram alert with the file list.
  Dedupes via `conflict_alerts` table.  Resolves automatically when either branch disappears
  (i.e. you merged it or closed it).
- Browse in the UI under **Admin → Conflicts** (toggle "include resolved" to see history).

### Comments + checkpoints + timeline
- Every task has its own detail page (`/tasks/:id`): description, comments thread, full
  state-change timeline, and durations (claim→submit, submit→merge).
- Developers can hit **Checkpoint** during a task to commit + push without changing status —
  useful for backing up WIP without ending the claim.
- The admin **Dashboard** (`/admin`) summarizes open work per project, active claims, average
  durations across merged tasks, and a feed of recent activity.

---

## Local development of the platform itself

If you want to hack on the platform code without a VPS:

```bash
# Postgres
docker run -d --name devplatform-db \
  -e POSTGRES_DB=devplatform -e POSTGRES_USER=devplatform -e POSTGRES_PASSWORD=dev \
  -p 5432:5432 postgres:16-alpine

# Backend
cd app
npm install
PGPASSWORD=dev PGHOST=localhost SESSION_SECRET=$(node -e 'console.log(require("crypto").randomBytes(48).toString("base64url"))') \
  GITHUB_TOKEN=dummy GITHUB_USER=dev GITHUB_EMAIL=dev@example.com PUBLIC_DOMAIN=localhost \
  npm run migrate
# (then) npm run dev

# Frontend (separate terminal)
cd app/frontend
npm install
npm run dev   # http://localhost:5173, proxies /api to :3000
```

The docker-based flows (claim/submit/workspace provisioning) need a running docker daemon
and the `devplatform/code-server` image present locally.

---

## Security boundaries — honest read

What this protects against:
- Casual exfiltration via "Save as…" in the browser IDE (download disabled in code-server).
- Cross-tenant repo access (each container only mounts the developer's scoped repos).
- Direct git push: developers have no GitHub credentials; the platform owns the PAT.

What it doesn't protect against:
- A developer copy-pasting code into a browser/email/etc.  No technical defense for this — that's what NDAs are for.
- A developer running `cat` and reading source aloud / screenshotting.
- A determined attacker who roots their own container — they could theoretically read the PAT
  while a push is in flight (it's piped, not stored).  Mitigation: rotate the PAT regularly.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "no workspace provisioned for you yet" on claim | Admin hasn't created the workspace — go to **Workspaces** and provision. |
| Claim succeeds but IDE shows no project folder | The container can't reach github.com. Check `docker logs <container>` and the PAT scope. |
| Submit fails with "push failed" | Branch protection on `main`? Or PAT lacks Contents: write on that repo. |
| Telegram silent | `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ADMIN_CHAT_ID` not set, or you didn't `/start` the bot first. |
| Conflict alerts not firing | Run the script manually: `node scripts/conflict-check.js` — check `git merge-tree` output. |
| Workspace subdomain 502s | Cert issued? `docker network inspect devplatform_devplatform-workspaces` — is the container on it? |

---

## License / authorship

Generated for Dedan with Claude Code, May 2026. Internal use.
