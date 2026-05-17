-- Each client project can override the commit author/email used by the platform
-- when committing+pushing on that project's behalf.  If left NULL, commits fall
-- back to the developer's container-wide identity (GIT_USER_NAME / GIT_USER_EMAIL
-- set by the entrypoint when the workspace is created).

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS git_author_name  TEXT,
  ADD COLUMN IF NOT EXISTS git_author_email TEXT;
