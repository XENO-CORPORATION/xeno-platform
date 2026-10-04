-- UP
-- RUN-08: concurrent code work needs explicit file/task ownership or
-- isolated worktrees, plus reviewed integration. Path locks are exclusive
-- per project; task claims are exclusive per task; worktrees isolate by
-- branch/prefix and integrate only under a second pair of eyes.
CREATE TABLE IF NOT EXISTS concurrent_path_locks (
  project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  holder_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  task_ref TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, path),
  CHECK (path <> '' AND left(path, 1) <> '/')
);
CREATE TABLE IF NOT EXISTS concurrent_task_claims (
  project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE CASCADE,
  task_ref TEXT NOT NULL,
  holder_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, task_ref)
);
CREATE TABLE IF NOT EXISTS isolated_worktrees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE CASCADE,
  task_ref TEXT NOT NULL,
  author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  branch TEXT NOT NULL,
  root_prefix TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'integrated', 'abandoned')),
  integrated_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  integrated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, branch),
  CHECK (root_prefix <> '' AND right(root_prefix, 1) = '/')
);
CREATE INDEX IF NOT EXISTS idx_isolated_worktrees_project ON isolated_worktrees(project_id, status);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM isolated_worktrees) THEN
    RAISE EXCEPTION 'worktree rollback refused: worktrees exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM concurrent_task_claims) THEN
    RAISE EXCEPTION 'task claim rollback refused: claims exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM concurrent_path_locks) THEN
    RAISE EXCEPTION 'path lock rollback refused: locks exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE isolated_worktrees;
  DROP TABLE concurrent_task_claims;
  DROP TABLE concurrent_path_locks;
END $$;
