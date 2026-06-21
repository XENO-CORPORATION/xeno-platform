-- UP
ALTER TABLE xeno_remote_runs
  ADD COLUMN IF NOT EXISTS workspace TEXT;

CREATE INDEX IF NOT EXISTS idx_xeno_remote_runs_user_workspace_created
  ON xeno_remote_runs(user_id, workspace, created_at DESC);

-- DOWN
DROP INDEX IF EXISTS idx_xeno_remote_runs_user_workspace_created;
ALTER TABLE xeno_remote_runs
  DROP COLUMN IF EXISTS workspace;
