-- Comments thread per task + a state-change history for time tracking / dashboard.

CREATE TABLE IF NOT EXISTS task_comments (
  id          BIGSERIAL PRIMARY KEY,
  task_id     BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS task_comments_task_idx ON task_comments(task_id, created_at);

CREATE TABLE IF NOT EXISTS task_events (
  id           BIGSERIAL PRIMARY KEY,
  task_id      BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  event_type   TEXT NOT NULL,
  -- Examples: 'created', 'claimed', 'checkpoint', 'submitted', 'pr_set', 'merged', 'closed', 'reopened'
  from_status  TEXT,
  to_status    TEXT,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS task_events_task_idx     ON task_events(task_id, created_at);
CREATE INDEX IF NOT EXISTS task_events_type_idx     ON task_events(event_type);
CREATE INDEX IF NOT EXISTS task_events_created_idx  ON task_events(created_at DESC);
