-- UP
-- ============================================================
-- XENO hosted remote runner durable state.
-- Live child processes remain process-local; these tables preserve run
-- metadata and event history for status/history reads after memory pruning
-- or a web-process restart.
-- ============================================================

CREATE TABLE IF NOT EXISTS xeno_remote_runs (
  run_id            TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  status            TEXT NOT NULL
                    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  prompt            TEXT NOT NULL,
  requested_cwd     TEXT,
  model             TEXT,
  permission_mode   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at        TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,
  exit_code         INTEGER,
  signal            TEXT
);

CREATE INDEX IF NOT EXISTS idx_xeno_remote_runs_user_created
  ON xeno_remote_runs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_xeno_remote_runs_status
  ON xeno_remote_runs(status);

CREATE TABLE IF NOT EXISTS xeno_remote_run_events (
  id          BIGSERIAL PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES xeno_remote_runs(run_id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  event       JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_xeno_remote_run_events_run_id
  ON xeno_remote_run_events(run_id, id);

CREATE INDEX IF NOT EXISTS idx_xeno_remote_run_events_type
  ON xeno_remote_run_events(event_type);

-- DOWN
DROP TABLE IF EXISTS xeno_remote_run_events;
DROP TABLE IF EXISTS xeno_remote_runs;
