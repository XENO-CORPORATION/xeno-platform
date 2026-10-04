-- UP
-- PUB-14: public projects fork. The fork reads only the live public
-- projection — drafts, funds, rentals, credentials, memberships and
-- private history are structurally unreachable — under a
-- redistributable license, and records independent ownership plus
-- upstream provenance.
CREATE TABLE IF NOT EXISTS project_forks (
  fork_project_id UUID PRIMARY KEY REFERENCES chat_projects(id) ON DELETE CASCADE,
  upstream_project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE RESTRICT,
  upstream_revision TEXT NOT NULL,
  upstream_license TEXT NOT NULL,
  metadata JSONB NOT NULL CHECK (jsonb_typeof(metadata) = 'object'),
  forked_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  forked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fork_project_id <> upstream_project_id)
);
CREATE INDEX IF NOT EXISTS idx_project_forks_upstream ON project_forks(upstream_project_id);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM project_forks) THEN
    RAISE EXCEPTION 'fork rollback refused: forks exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE project_forks;
END $$;
