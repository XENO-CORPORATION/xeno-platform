-- UP
-- A person runs one of their own platform agents on a task in the cloud. Each row links the agent, the pinned
-- version of its instructions, the task, and the hosted run in xeno-agents-api that executes it. Billing is the
-- hosted run's own ledger hold (sized by budget_credits); the division boundary is enforced by the agent's own
-- credential on every Tasks call. The credential is referenced, never stored (its hash lives in
-- task_agent_tokens), and is revoked when the run ends. A workforce admission joins this record when hosted runs
-- forward run leases to the gateway (XENO-WORKFORCE-01 RUN-03); until then there is no admission to point at.
CREATE TABLE IF NOT EXISTS agent_cloud_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_version integer NOT NULL CHECK (agent_version >= 1),
  credential_id uuid NULL,
  run_id text NULL,
  state text NOT NULL DEFAULT 'starting'
    CHECK (state IN ('starting', 'queued', 'running', 'completed', 'failed', 'cancelled', 'refused', 'uncertain')),
  reason text NULL CHECK (reason IS NULL OR char_length(reason) <= 200),
  budget_credits numeric(12,4) NOT NULL CHECK (budget_credits > 0 AND budget_credits <= 1000),
  delegated_sids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS agent_cloud_runs_owner_idx ON agent_cloud_runs (owner_user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS agent_cloud_runs_run_key ON agent_cloud_runs (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_cloud_runs_task_idx ON agent_cloud_runs (task_id, created_at DESC);
-- one live run per agent per task: a second press while one runs returns the first
CREATE UNIQUE INDEX IF NOT EXISTS agent_cloud_runs_live_key ON agent_cloud_runs (agent_user_id, task_id)
  WHERE state IN ('starting', 'queued', 'running');

-- the agent must be the owner's own (the same rule as every other agent surface)
CREATE OR REPLACE FUNCTION agent_cloud_runs_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM agent_identities WHERE user_id = NEW.agent_user_id AND owner_user_id = NEW.owner_user_id) THEN
    RAISE EXCEPTION 'a cloud run is of an agent its person owns' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.owner_user_id <> OLD.owner_user_id OR NEW.agent_user_id <> OLD.agent_user_id
      OR NEW.task_id <> OLD.task_id OR NEW.agent_version <> OLD.agent_version) THEN
    RAISE EXCEPTION 'a cloud run never changes whose, which agent, which task or which version' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS agent_cloud_runs_guard ON agent_cloud_runs;
CREATE TRIGGER agent_cloud_runs_guard BEFORE INSERT OR UPDATE ON agent_cloud_runs
  FOR EACH ROW EXECUTE FUNCTION agent_cloud_runs_guard();

-- DOWN
DROP TRIGGER IF EXISTS agent_cloud_runs_guard ON agent_cloud_runs;
DROP FUNCTION IF EXISTS agent_cloud_runs_guard();
DROP TABLE IF EXISTS agent_cloud_runs;
