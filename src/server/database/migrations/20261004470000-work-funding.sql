-- UP
-- PUB-09: external work is contributor-funded by default; project
-- money moves only under a separately accepted budget grant, agent
-- invocation needs the owner's consent plus payer approval, and no
-- payout is implied by acceptance. Grant-origin engagements carry
-- the grant instead of an offer.
CREATE TABLE IF NOT EXISTS project_budget_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  requester_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  payer_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_micro BIGINT NOT NULL CHECK (amount_micro > 0),
  state TEXT NOT NULL DEFAULT 'proposed'
    CHECK (state IN ('proposed', 'accepted', 'declined', 'revoked', 'dispatched')),
  decided_by_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  decided_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (state NOT IN ('accepted', 'dispatched') OR payer_user_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_project_budget_grants_task ON project_budget_grants(task_id, state);
-- An offered agent is invocable by others only with the owner's live
-- consent for the task. Offering alone authorizes nothing.
CREATE TABLE IF NOT EXISTS agent_invocation_consents (
  resource_id UUID NOT NULL REFERENCES workforce_resources(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  granted_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (resource_id, task_id),
  CHECK (expires_at > granted_at)
);
ALTER TABLE task_engagements ALTER COLUMN offer_id DROP NOT NULL;
ALTER TABLE task_engagements DROP CONSTRAINT IF EXISTS task_engagements_origin_check;
ALTER TABLE task_engagements ADD CONSTRAINT task_engagements_origin_check
  CHECK (origin IN ('manual', 'auto', 'grant'));
ALTER TABLE task_engagements ADD COLUMN IF NOT EXISTS grant_id UUID NULL
  REFERENCES project_budget_grants(id) ON DELETE RESTRICT;
ALTER TABLE task_engagements ADD CONSTRAINT task_engagements_grant_shape_check CHECK (
  (origin = 'grant' AND offer_id IS NULL AND grant_id IS NOT NULL)
  OR (origin <> 'grant' AND offer_id IS NOT NULL AND grant_id IS NULL)
);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM project_budget_grants) THEN
    RAISE EXCEPTION 'funding rollback refused: grants exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM agent_invocation_consents) THEN
    RAISE EXCEPTION 'funding rollback refused: consents exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM task_engagements WHERE origin = 'grant') THEN
    RAISE EXCEPTION 'funding rollback refused: grant engagements exist' USING ERRCODE='23514';
  END IF;
  ALTER TABLE task_engagements DROP CONSTRAINT task_engagements_grant_shape_check;
  ALTER TABLE task_engagements DROP COLUMN grant_id;
  ALTER TABLE task_engagements DROP CONSTRAINT task_engagements_origin_check;
  ALTER TABLE task_engagements ADD CONSTRAINT task_engagements_origin_check
    CHECK (origin IN ('manual', 'auto'));
  ALTER TABLE task_engagements ALTER COLUMN offer_id SET NOT NULL;
  DROP TABLE agent_invocation_consents;
  DROP TABLE project_budget_grants;
END $$;
