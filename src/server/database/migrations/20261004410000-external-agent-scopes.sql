-- UP
-- PUB-08: external contributors' agents run under scoped identities.
-- Each scope binds one agent user to one task engagement; every scoped
-- read rechecks liveness, so expiry revokes uniformly.
CREATE TABLE IF NOT EXISTS external_agent_scopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  engagement_id UUID NOT NULL UNIQUE REFERENCES task_engagements(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  bound_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS idx_external_agent_scopes_agent ON external_agent_scopes(agent_user_id, expires_at);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM external_agent_scopes WHERE expires_at > now()) THEN
    RAISE EXCEPTION 'scope rollback refused: live scopes exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM external_agent_scopes) THEN
    RAISE EXCEPTION 'scope rollback refused: scopes exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE external_agent_scopes;
END $$;
