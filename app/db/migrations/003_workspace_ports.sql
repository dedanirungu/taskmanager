-- Each workspace container is bound to 127.0.0.1:<host_port>:8080 so host nginx can
-- proxy to it.  Allocated from a configurable range (default 8081–8199).

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS host_port INTEGER UNIQUE;
