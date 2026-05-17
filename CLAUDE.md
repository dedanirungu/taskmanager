# CLAUDE.md

Project-specific guidance for Claude Code working on this repo.

For a full design overview, read [`plan.md`](./plan.md).
For ops / deploy, read [`README.md`](./README.md).
This file captures the things that aren't obvious from those.

---

## What this is

Self-hosted control plane that gives subcontracted developers a browser-VSCode
workspace per person to work on the operator's client repos with Claude Code,
without ever touching the source on their own machines.  Operator (admin) owns
all GitHub credentials; developers never see them.

Deployed at **https://platform.178.105.122.232.sslip.io** on a single Hetzner-style
Ubuntu 24.04 VPS, root SSH access.  Repo location on the VPS: `/srv/devplatform`.

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Backend  | Fastify (Node 20, ESM)         | `app/src/` — `type: module`. Always use `import`, never `require`. |
| DB       | PostgreSQL 16 (docker container) | Migrations in `app/db/migrations/NNN_*.sql` — applied in lexical order on app startup. |
| Frontend | Vite + React 18 SPA            | `app/frontend/` — built into `app/frontend/dist` and served by Fastify. |
| IDE      | code-server (Coder)            | Per-developer container; image built from `docker/code-server/Dockerfile`. |
| Proxy    | nginx on the host              | Subdomain per workspace; certs via certbot + Let's Encrypt (`sslip.io` for DNS-free hostnames). |
| Cron     | Linux cron on the host         | conflict-check every 20 min, backup nightly. Scripts in `scripts/`. |

## Conventions

### Migrations
- Numbered SQL files only.  Always start with `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` so re-running is safe.
- Don't edit an applied migration; add a new one.
- Migrations are run automatically by `src/db/migrate.js` on every app boot
  (see Dockerfile CMD).  Don't shell into the DB to ALTER manually.

### Routes
- `app/src/routes/*.js`, each exported as a Fastify plugin.  Register in `server.js`.
- Auth: `requireUser` / `requireAdmin` from `middleware/auth.js`.  Add as `preHandler`.
- Scope-aware queries: use `visibleProjectIds(user)` — returns `null` (= "all") for admins.
- Side-effecting state changes (task lifecycle, workspace lifecycle) should
  emit a `task_events` row via `services/events.js` and an `audit_log` row
  via `services/audit.js`.

### Frontend
- One page per route under `pages/`.  Routes are wired in `App.jsx`.
- Auth state from `lib/auth.jsx` (`useAuth`).  Use `api` helper from `lib/api.js`
  for fetch — it handles cookies and error shape.
- Plain CSS in `styles.css`, no Tailwind/CSS-in-JS.  Match the existing dark
  panel/table aesthetic — see existing pages for patterns.
- No client-side routing through `<a href>` — always `<Link>` / `<NavLink>` from react-router-dom.

### Commit identity
- Resolution order:  per-project author → `PLATFORM_GIT_NAME`/`EMAIL` → `GITHUB_USER`/`EMAIL`.
- Subcontracted developer identity must NEVER leak into git history — clients
  don't know about them.  See `services/docker.js::effectiveCommitIdentity`.

### Container lifecycle
- Workspace containers are managed via `dockerode` in `services/docker.js`.
- The platform container itself talks to the host docker daemon via the
  bind-mounted socket.  When asking docker to mount workspace paths, **the path
  must exist on the HOST**, not just inside the platform container.  We solve
  this by mounting `${APP_HOST_DIR}/workspaces` at the same path inside the
  container (so paths resolve identically in both views).  Don't reintroduce
  asymmetric paths or you'll get root-owned empty dirs at the wrong location.
- Workspace dirs are chowned to uid 1000 (the `coder` user inside code-server)
  in `ensureWorkspaceDirs`.

### Ports
- Platform app: `127.0.0.1:3000` (host) → nginx proxies `platform.<domain>`.
- Workspaces: each bound to `127.0.0.1:<host_port>:8080`, host_port allocated
  from `WORKSPACE_PORT_MIN..MAX` (default 8081..8199).
- Preview ports: `127.0.0.1:<host_port>:<internal_port>`, host_port from
  `PREVIEW_PORT_MIN..MAX` (default 8201..8499).
- After adding/removing preview ports, the workspace container is recreated
  (port bindings are immutable).

### nginx config
- Templates in `nginx/conf.d/*.conf.template`.  Don't write hand-edited
  `conf.d/devplatform-*.conf` on the box — they're regenerated.
- Use `scripts/render-nginx.sh` to rebuild from DB state.  It reads the
  current workspaces + previews from postgres and emits one file per workspace.
- When using `envsubst`, ALWAYS pass the variable whitelist
  (`envsubst '$PUBLIC_DOMAIN $UPSTREAM ...'`) — otherwise it will expand
  nginx's own `$host`/`$remote_addr` etc.  This was a real bug, fixed in `2aa4379`.

### Backups
- Nightly cron runs `scripts/backup.sh`.  Dumps go to `/srv/devplatform/backups/db/`,
  workspace rsync mirror to `/srv/devplatform/backups/workspaces/latest/`.
- Don't put backups inside the app's working tree — `.gitignore` excludes them.

## Common gotchas

1. **Docker-in-docker path mismatch.** See "Container lifecycle" above.
2. **envsubst eats nginx variables.** Always whitelist.
3. **Bash crontab pipe + pipefail.** `crontab -l 2>/dev/null | grep ...`
   exits non-zero when crontab is empty, killing scripts with `set -euo pipefail`.
   Use `crontab -l 2>/dev/null || true` and `grep || true`.  Fixed in `eebeee4`.
4. **Dockerfile must copy db/.** The migrate script reads `db/migrations/`.
   If you reorganize directories, update the Dockerfile.  Fixed in `531d2ff`.
5. **Workspace volumes are root-owned by default.**  `ensureWorkspaceDirs`
   chowns to 1000:1000; don't skip that step or code-server crashes with
   EACCES on `/home/coder/.config/code-server`.
6. **HTTP-01 cert challenge needs nginx already running on port 80** and
   the domain already resolving here.  `sslip.io` solves DNS automatically;
   make sure nginx is up before calling `issue-certs.sh`.
7. **`cd <repo> && git ...` triggers Claude Code's permission prompt.**
   Just run `git` directly — it already operates on the current working tree.

## Running locally vs on the VPS

### Local dev
```bash
docker run -d --name devplatform-db \
  -e POSTGRES_DB=devplatform -e POSTGRES_USER=devplatform -e POSTGRES_PASSWORD=dev \
  -p 5432:5432 postgres:16-alpine

cd app
npm install
PGPASSWORD=dev PGHOST=localhost \
  SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))") \
  GITHUB_TOKEN=dummy GITHUB_USER=dev GITHUB_EMAIL=dev@example.com \
  PUBLIC_DOMAIN=localhost PORT=3000 \
  npm run migrate && npm run dev

cd app/frontend && npm install && npm run dev   # vite at :5173, proxies /api → :3000
```

The docker-managed parts (claim/submit/workspace provisioning) need a running
docker daemon AND the `devplatform/code-server:latest` image present locally
(`docker build -t devplatform/code-server:latest docker/code-server/`).

### On the VPS
```bash
# After code change:
cd /srv/devplatform && git pull && \
  docker compose -f docker-compose.platform.yml up -d --build app && \
  docker logs --tail=10 devplatform-app

# For nginx changes (cert + render):
bash scripts/issue-certs.sh <new-subdomain>.178.105.122.232.sslip.io
bash scripts/render-nginx.sh
```

## When making changes

- **Verify before claiming done.** Build the docker image and check logs.
  Smoke test the affected endpoint with `curl`.
- **Don't migrate the DB by hand** — always add a numbered migration.
- **Don't write secrets into the repo.**  `.env` is gitignored; secrets only
  in `/srv/devplatform/.env` on the VPS.
- **Commit messages: short subject (≤70c), body explains WHY** if non-obvious.
  Include `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **Push to GitHub** unless explicitly told otherwise.  The user is mid-deploy
  and pulls on the VPS after every push.

## Key file map

```
plan.md                         design + architecture
README.md                       operator's quick start

app/
  Dockerfile                    multi-stage: frontend build, then runtime
  package.json                  ESM, Fastify 4
  db/migrations/                NNN_name.sql, applied in order
  src/
    server.js                   Fastify entrypoint + static SPA
    db/                         pool, migrate, seed-admin
    middleware/auth.js          loadUser, requireUser, requireAdmin, visibleProjectIds
    routes/
      auth.js                   login / logout / me
      admin.js                  projects, users, workspaces, preview ports
      tasks.js                  create / claim / checkpoint / submit / pr-url / merged / close
      comments.js               task comments, events, single-task GET
      dashboard.js              /api/admin/dashboard + /api/admin/conflicts
      me.js                     /api/me/workspace, /api/me/projects
    services/
      audit.js                  fire-and-forget audit_log writer
      events.js                 task_events writer
      docker.js                 dockerode wrappers, container lifecycle, git ops inside containers
      github.js                 octokit + authenticatedCloneUrl + tokenForProject
      telegram.js               Bot API sender
    util/{slug,random}.js
  frontend/
    vite.config.js              proxies /api → :3000 in dev
    src/
      App.jsx                   routes
      lib/{api,auth}.js[x]      fetch helper + auth context
      components/Layout.jsx     sidebar shell
      pages/{LoginPage,TaskBoard,TaskDetail,MyWorkspace,AdminDashboard,
             AdminProjects,AdminUsers,AdminWorkspaces,AdminConflicts,AdminAudit}.jsx
      styles.css                all CSS

docker/code-server/             per-developer IDE image
  Dockerfile                    code-server + node + claude code CLI + extensions
  entrypoint.sh                 writes git config inside container

docker-compose.platform.yml     db + app
nginx/conf.d/*.template         platform / workspace / preview blocks

scripts/
  setup-vps.sh                  one-shot Ubuntu 24.04 bootstrap
  issue-certs.sh                certbot --nginx, reads CERTBOT_EMAIL from .env
  render-nginx.sh               rebuild nginx confs from DB
  install-cron.sh               conflict-check every 20 min
  install-backup-cron.sh        nightly pg_dump + workspace rsync
  conflict-check.js             ESM cron: bare clones + git merge-tree
  pr-status-sync.js             ESM cron: poll GH for merged PRs
  backup.sh                     pg_dump + rsync
  package.json                  ESM declaration for the cron scripts

systemd/devplatform.service     optional systemd unit
```
