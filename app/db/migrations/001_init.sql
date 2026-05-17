-- Initial schema for the developer platform.

CREATE TABLE IF NOT EXISTS users (
  id                BIGSERIAL PRIMARY KEY,
  username          TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  email             TEXT,
  telegram_chat_id  TEXT,
  role              TEXT NOT NULL CHECK (role IN ('admin', 'developer')),
  access_scope      TEXT NOT NULL DEFAULT 'scoped' CHECK (access_scope IN ('all', 'scoped')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id              BIGSERIAL PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  slug            TEXT NOT NULL UNIQUE,
  github_repo     TEXT NOT NULL,           -- "owner/name"
  default_branch  TEXT NOT NULL DEFAULT 'main',
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_projects (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id            BIGSERIAL PRIMARY KEY,
  project_id    BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','in_progress','submitted','awaiting_review','merged','closed')),
  branch_name   TEXT,
  assigned_to   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_by    BIGINT NOT NULL REFERENCES users(id),
  pr_url        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at    TIMESTAMPTZ,
  submitted_at  TIMESTAMPTZ,
  merged_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS tasks_status_idx        ON tasks(status);
CREATE INDEX IF NOT EXISTS tasks_assigned_to_idx   ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS tasks_project_id_idx    ON tasks(project_id);

CREATE TABLE IF NOT EXISTS workspaces (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  container_name   TEXT NOT NULL UNIQUE,
  subdomain        TEXT NOT NULL UNIQUE,
  ide_password     TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'stopped' CHECK (status IN ('running','stopped','error')),
  current_task_id  BIGINT REFERENCES tasks(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conflict_alerts (
  id                  BIGSERIAL PRIMARY KEY,
  project_id          BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  branch_a            TEXT NOT NULL,
  branch_b            TEXT NOT NULL,
  conflicting_files   JSONB NOT NULL DEFAULT '[]'::jsonb,
  alerted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at         TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS conflict_alerts_open_pair_idx
  ON conflict_alerts(project_id, branch_a, branch_b)
  WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target      TEXT,
  payload     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log(created_at DESC);

-- Sessions table for @fastify/session with a pg store fallback (we use in-process by default).
-- Keeping the table available makes scaling out easier later.
CREATE TABLE IF NOT EXISTS sessions (
  sid          TEXT PRIMARY KEY,
  sess         JSONB NOT NULL,
  expire       TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions(expire);
