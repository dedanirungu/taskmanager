# Developer Platform — Implementation Plan

> A self-hosted task-board + browser-VS-Code platform that lets multiple developers work on client projects with Claude Code, without ever downloading the codebase.

---

## 1. Overview

You manage **5 client projects** and want to bring in additional developers without:
- Giving them git/SSH/SCP access
- Letting them download files
- Exposing other clients' code to them

The platform is a small web app (control plane) plus per-developer Docker containers (workspaces). You post tasks, developers claim tasks, the platform creates branches and prepares their workspace, they code with Claude, then click "Done." You handle PRs manually on GitHub.

---

## 2. Final Locked Spec

| Decision | Choice |
|---|---|
| Workspace model | 1 persistent container per developer |
| IDE | code-server (browser VS Code) |
| Claude | Each developer uses their own Claude Pro account |
| Developer access tiers | `full-access` (sees all repos) or `project-scoped` (sees only assigned projects) |
| Git operations | Platform handles all; developers never touch git |
| Branch creation | Automatic when task is claimed |
| Commit + push | Automatic when task is marked done |
| PR creation | Manual — you do it on GitHub |
| Merge | Manual on GitHub |
| Conflict detection | Cron script every 20 minutes on bare clones |
| Conflict notification | Telegram (one alert per conflict pair, no spam) |
| File downloads | Disabled via `--disable-file-downloads` |
| Active tasks per dev | One at a time |
| Auth | Username + password (admin creates accounts) |

---

## 3. System Architecture

```
                          ┌───────────────────────────┐
                          │     YOUR VPS (Hetzner)    │
                          │   Ubuntu, 16GB, 4 vCPU    │
                          └───────────────────────────┘
                                       │
            ┌──────────────────────────┼──────────────────────────┐
            │                          │                          │
            ▼                          ▼                          ▼
   ┌─────────────────┐       ┌─────────────────┐        ┌──────────────────┐
   │  Nginx (HTTPS)  │       │  Platform App   │        │  Conflict Cron   │
   │  Reverse Proxy  │◄──────│  (Node.js +     │        │  (runs every     │
   │                 │       │   PostgreSQL)   │        │   20 minutes)    │
   └────────┬────────┘       └────────┬────────┘        └────────┬─────────┘
            │                         │                          │
            │ subdomains              │ docker exec              │ git ops on
            │                         │ git ops                  │ bare clones
            │                         │                          │
            ▼                         ▼                          ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │                        DOCKER CONTAINERS                             │
   │                                                                      │
   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
   │  │ dev1-workspace│  │ dev2-workspace│  │ dev3-workspace│   ...        │
   │  │              │  │              │  │              │               │
   │  │ code-server  │  │ code-server  │  │ code-server  │               │
   │  │ Claude Code  │  │ Claude Code  │  │ Claude Code  │               │
   │  │ Project repos│  │ Project repos│  │ Project repos│               │
   │  │ (only their  │  │ (only their  │  │ (only their  │               │
   │  │  scope)      │  │  scope)      │  │  scope)      │               │
   │  └──────────────┘  └──────────────┘  └──────────────┘               │
   └─────────────────────────────────────────────────────────────────────┘

   ┌─────────────────────────────────────────────────────────────────────┐
   │              BARE CLONES (conflict-check use only)                  │
   │  /srv/conflict-check/client1.git   ... client5.git                  │
   └─────────────────────────────────────────────────────────────────────┘
```

### Domain layout

```
platform.yourdomain.com         → the task-board admin/dev UI
dev1.yourdomain.com             → developer 1's code-server
dev2.yourdomain.com             → developer 2's code-server
...
```

---

## 4. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Backend | Node.js (Express or Fastify) | You already work in JS; great GitHub API libs |
| Database | PostgreSQL | Reliable, easy to back up |
| Frontend | React SPA (you already use React) | Reuse your component skills |
| IDE | code-server (Coder, open source) | Browser VS Code with download-disable flag |
| Containers | Docker + Docker Compose | Standard, easy to template per-developer |
| Reverse proxy | Nginx | Subdomain routing + HTTPS via Let's Encrypt |
| Git host | GitHub (private repos, your account) | Easiest API for branches/PRs |
| Notifications | Telegram Bot API + SMTP | Telegram for urgent, email for casual |
| Process supervision | systemd | Native, simple |
| Cron | Standard Linux cron | For the 20-minute conflict scanner |

---

## 5. Database Schema (sketch)

```sql
-- Users (you + developers)
users (
  id, username, password_hash, email, telegram_chat_id,
  role,              -- 'admin' | 'developer'
  access_scope,      -- 'all' | 'scoped'
  created_at
)

-- Which projects a scoped developer can see
user_projects (
  user_id, project_id
)

-- Client projects
projects (
  id, name, github_repo,   -- e.g. "yourorg/client1-app"
  default_branch,           -- usually 'main'
  description, created_at
)

-- Tasks (the board)
tasks (
  id, project_id, title, description,
  status,            -- 'open' | 'claimed' | 'in_progress' | 'submitted' | 'merged' | 'closed'
  branch_name,       -- 'task/12-fix-login'
  assigned_to,       -- user_id (null when open)
  created_by,        -- user_id (you)
  pr_url,            -- filled in after you open PR on GitHub
  created_at, claimed_at, submitted_at
)

-- Developer workspaces
workspaces (
  id, user_id,
  container_name,    -- 'dev1-workspace'
  subdomain,         -- 'dev1.yourdomain.com'
  status,            -- 'running' | 'stopped'
  current_task_id,   -- which task they have open
  created_at
)

-- Conflict tracking (so we don't spam Telegram)
conflict_alerts (
  id, project_id,
  branch_a, branch_b,
  conflicting_files, -- JSON array
  alerted_at,
  resolved_at        -- set when a branch is merged/closed
)
```

---

## 6. User Flows

### A. Admin (you) creating a task

1. Log into `platform.yourdomain.com`
2. Click "New Task" → pick project, write title + description
3. Task appears on board with status `open`

### B. Developer claiming a task

1. Developer logs into platform → sees task board (filtered to their scope)
2. Clicks "Claim" on a task
3. Backend does:
   - Validates dev has no other active task
   - `git checkout -b task/{id}-{slug}` inside their container's clone of that repo
   - Updates task → `in_progress`, assigns to dev
   - Updates workspace → `current_task_id = task.id`
4. Frontend redirects developer to their workspace URL (`devN.yourdomain.com`)
5. code-server opens with the correct folder, on the correct branch

### C. Developer working

1. Developer codes in browser VS Code
2. Opens terminal, runs `claude` (Claude Code CLI)
3. First time only: authorize their own Claude Pro account via OAuth
4. Claude assists with edits — they work normally

### D. Developer marking done

1. Clicks "Submit Task" on platform UI
2. Backend does inside container:
   - `git add .`
   - `git commit -m "Task #{id}: {title}"`
   - `git push origin task/{id}-{slug}` (using your GitHub token)
3. Task status → `submitted`
4. Telegram alerts you: "Task #12 submitted by dev1, ready for PR"

### E. You opening PR

1. You go to GitHub manually
2. Open PR from the branch into `main`
3. Paste PR URL back into the task on the platform (or platform fetches it via API)
4. Task status → `awaiting_review`

### F. Merge or conflict

- You merge on GitHub → cron script eventually detects the branch is gone, marks task `merged`
- If conflict with another open branch → conflict-check cron sends Telegram alert

---

## 7. The Conflict-Check Script

Runs every 20 minutes via cron.

```bash
*/20 * * * * /usr/bin/node /srv/devplatform/scripts/conflict-check.js >> /var/log/conflict-check.log 2>&1
```

Pseudocode:

```
for each project in DB:
    cd /srv/conflict-check/{project}.git
    git fetch origin --prune

    active_branches = DB.query("SELECT branch_name FROM tasks WHERE status IN ('in_progress','submitted') AND project_id = ?")

    for each (branchA, branchB) pair in active_branches:
        already_alerted = DB.exists(conflict_alerts WHERE branch_a=A, branch_b=B, resolved_at IS NULL)
        if already_alerted: continue

        # Test merge in a worktree to avoid polluting the bare clone
        result = git merge-tree --write-tree origin/branchA origin/branchB
        if conflict markers in result:
            files = extract_conflicting_files(result)
            send_telegram(project, branchA, branchB, files)
            DB.insert(conflict_alerts, ...)

    # Resolve old alerts where one branch no longer exists / was merged
    for alert in open_alerts:
        if either branch no longer exists on remote:
            DB.update(alert.resolved_at = NOW())
```

**Why bare clones?** Doing `git merge` on a working copy would interfere with developers' live workspaces. Bare clones are read-only for the check and never disrupt the running containers.

---

## 8. The code-server Container Image

Dockerfile sketch:

```dockerfile
FROM codercom/code-server:latest

USER root

# Install Node.js (for Claude Code)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs git

# Install Claude Code globally
RUN npm install -g @anthropic-ai/claude-code

# Pre-install useful VS Code extensions
RUN code-server --install-extension dbaeumer.vscode-eslint \
    && code-server --install-extension esbenp.prettier-vscode

USER coder

# Default args (overridden by docker-compose per developer)
CMD ["code-server", \
     "--bind-addr", "0.0.0.0:8080", \
     "--auth", "password", \
     "--disable-file-downloads", \
     "--disable-telemetry"]
```

Per-developer docker-compose.yml (generated by platform):

```yaml
services:
  dev1-workspace:
    image: devplatform/code-server:latest
    container_name: dev1-workspace
    ports:
      - "8081:8080"
    environment:
      PASSWORD: "${DEV1_PASSWORD}"
    volumes:
      - ./workspaces/dev1:/home/coder/projects
      - ./workspaces/dev1/.config:/home/coder/.config
    restart: unless-stopped
```

Each developer's `/home/coder/projects` is populated by the platform with the repos they're allowed to see (clones the platform manages, not GitHub auth on the dev's behalf).

---

## 9. Security Model — Honest Boundaries

| Threat | Defense |
|---|---|
| Developer downloads files via UI | Blocked by `--disable-file-downloads` |
| Developer SCP/SFTP | No SSH access exists |
| Developer accesses another client's repo | Their container only mounts repos in their `access_scope` |
| Developer pushes rogue commits to GitHub | They have no GitHub credentials; platform owns the token |
| Developer creates extra branches | They can technically run `git` in terminal, but pushes fail without your token |
| Developer copy-pastes code manually | NDA + contract (no technical defense possible) |
| Developer abuses Claude Pro | They use their own account; not your problem |
| Telegram alerts spamming | DB tracks alerted pairs, only alerts once per pair |

The protection is **convenience-level + legal**, not cryptographic. Standard for agency setups.

---

## 10. VPS Sizing

For ~5 concurrent developer workspaces:

| Resource | Recommended |
|---|---|
| RAM | 16 GB |
| CPU | 4 vCores |
| Storage | 80 GB SSD |
| Bandwidth | 10 TB/mo (way more than enough) |

Best providers from Kenya:
- **Hetzner** (CX42 or CCX13) — best value, ~KES 4,000–5,500/mo
- **DigitalOcean** — easier UI, ~KES 6,500/mo
- **Linode** — similar to DO

---

## 11. File / Folder Layout on the VPS

```
/srv/devplatform/
├── app/                          # the Node.js platform
│   ├── src/
│   │   ├── routes/
│   │   ├── services/
│   │   │   ├── github.js         # branch + push + repo ops
│   │   │   ├── docker.js         # container lifecycle
│   │   │   ├── telegram.js
│   │   │   └── conflicts.js
│   │   └── models/
│   ├── frontend/                 # React SPA
│   └── package.json
├── scripts/
│   └── conflict-check.js         # the 20-minute cron job
├── workspaces/
│   ├── dev1/                     # mounted into dev1-workspace
│   ├── dev2/
│   └── ...
├── docker-compose.platform.yml   # the platform itself
├── docker-compose.workspaces.yml # all developer workspaces
└── nginx/
    └── conf.d/                   # subdomain routing

/srv/conflict-check/
├── client1.git/                  # bare clones
├── client2.git/
└── ...
```

---

## 12. Implementation Phases

### Phase 1 — Foundation (1–2 days)
- Spin up VPS (Hetzner)
- Install Docker, Node.js, PostgreSQL, Nginx
- Configure domain + Let's Encrypt SSL
- Build the code-server Docker image with Claude Code baked in
- Smoke test: manually run 1 container, log in via browser, run `claude`

### Phase 2 — Platform MVP (3–5 days)
- DB schema + migrations
- Auth (username/password, bcrypt, sessions)
- Admin UI: create projects, create tasks, create users
- Developer UI: task board (filtered by scope), claim button
- Backend: claim a task → create branch in container → update task

### Phase 3 — Submission flow (1–2 days)
- "Submit Task" button → commit + push via GitHub API
- Task status updates
- Telegram alert on submission

### Phase 4 — Conflict detection (1 day)
- Bare clones setup
- `conflict-check.js` script
- Telegram alert with file list
- Cron entry

### Phase 5 — Hardening (1–2 days)
- Rate limiting on platform endpoints
- Audit log (who claimed/submitted what when)
- Backup script for DB + workspaces

**Total: ~7–12 days of focused work.**

---

## 13. Outstanding Decisions for Later

These don't block building the MVP but are worth thinking about:

1. **Backup strategy** — daily DB dumps + weekly workspace snapshots?
2. **Workspace persistence on container restart** — should Claude Code auth persist? (Yes, via volume mount of `.config`)
3. **Multi-commit support** — currently spec says one commit per task. Do you want devs to be able to checkpoint mid-task?
4. **Task comments / chat** — should you and the dev be able to discuss a task on the platform, or is Telegram/email enough?
5. **Time tracking** — log when tasks are claimed vs submitted, for billing or reporting?
6. **Dashboard for you** — open tasks, active branches per project, conflict alerts, etc.

---

## 14. Quick-Start Checklist (when you resume)

```
[ ] Buy domain (or reuse existing)
[ ] Provision Hetzner CCX13 VPS (Ubuntu 24.04)
[ ] Point platform.yourdomain.com + dev*.yourdomain.com A records to VPS
[ ] Install Docker, Docker Compose, Node 20, PostgreSQL, Nginx, certbot
[ ] Create GitHub PAT (fine-grained, scoped to your 5 repos, repo + contents:write + pull_requests:write)
[ ] Create Telegram bot via @BotFather, get your chat ID
[ ] Build the platform repo (use this plan as the README)
[ ] Build code-server Docker image
[ ] Run Phase 2 MVP locally first, then deploy
```

---

## 15. Key Reference Commands

```bash
# Create a branch inside a developer's container
docker exec dev1-workspace bash -c "cd /home/coder/projects/client1 && git checkout main && git pull && git checkout -b task/12-fix-login"

# Commit + push from inside a container (platform does this)
docker exec dev1-workspace bash -c "cd /home/coder/projects/client1 && git add . && git commit -m 'Task #12: fix login' && git push origin task/12-fix-login"

# Test for merge conflict between two branches (bare clone)
cd /srv/conflict-check/client1.git
git merge-tree --write-tree origin/task/12-fix-login origin/task/13-add-dashboard | grep -E "^<<<<<<< |^>>>>>>> "

# Start/stop a workspace
docker compose -f docker-compose.workspaces.yml up -d dev1-workspace
docker compose -f docker-compose.workspaces.yml stop dev1-workspace
```

---

*Plan generated for Dedan — pick up from here on any machine.*
