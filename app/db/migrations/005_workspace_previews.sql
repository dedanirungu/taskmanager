-- Each developer workspace can expose any number of "preview" URLs — one per port
-- inside their container that they want reachable from the browser.  e.g. a vite
-- dev server on 5173 → https://app-dev1.<domain>, plus a backend on 8000 →
-- https://api-dev1.<domain>.
--
--   subdomain = "<name>-<workspace.subdomain>"   (DNS label)
--   container bind = 127.0.0.1:<host_port>:<internal_port>
--   nginx proxies the subdomain to 127.0.0.1:<host_port>

CREATE TABLE IF NOT EXISTS workspace_previews (
  id             BIGSERIAL PRIMARY KEY,
  workspace_id   BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  internal_port  INTEGER NOT NULL,
  host_port      INTEGER NOT NULL UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, name),
  UNIQUE (workspace_id, internal_port),
  CHECK (internal_port BETWEEN 1 AND 65535),
  CHECK (host_port BETWEEN 1 AND 65535),
  CHECK (name ~ '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$')   -- valid DNS label
);

CREATE INDEX IF NOT EXISTS workspace_previews_workspace_idx ON workspace_previews(workspace_id);
