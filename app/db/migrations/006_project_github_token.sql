-- One project may live under a different GitHub account than the platform's
-- default PAT.  Store an optional per-project token; if set, the platform
-- uses it for clone/push on that project instead of GITHUB_TOKEN from .env.
--
-- Storage note: plain TEXT for now. Self-hosted single-tenant setup, .env
-- already holds the master PAT in plain text. Future improvement: encrypt
-- at rest with a key derived from SESSION_SECRET.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS github_token TEXT;
