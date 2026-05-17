-- "Client" groups N projects together (e.g. a client whose product has
-- mobile + backend + frontend repos).  Sibling repos in the same client
-- are auto-cloned into a developer's workspace so they can run e.g. the
-- backend locally while iterating on mobile.
--
-- Project visibility is still controlled by user_projects per-project —
-- a client can have an "ops" repo that's scoped only to the admin.

CREATE TABLE IF NOT EXISTS clients (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS client_id BIGINT REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS projects_client_id_idx ON projects(client_id);
