-- UP
-- XENO Automate (Dev › Automate) = XENO Workflow (owner, 2026-10-23: "for automate we already have xeno workflow that
-- needs to power this"). The platform stores a workspace's workflows in xeno-workflow's OWN graph format and runs them on
-- the xeno-workflow headless runner (services/xenoWorkflow.js, docs/AUTOMATE-XENO-WORKFLOW.md). No engine lives here:
-- these tables are the workspace's record of WHAT runs, WHEN (the trigger delivery queue) and WHAT HAPPENED (results).
-- ADDITIVE ONLY: two tables, one function, one trigger. DOWN drops exactly them.
CREATE TABLE IF NOT EXISTS workspace_workflows (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                 text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description          text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  -- a xeno-workflow WorkflowDefinition { nodes, edges, variables, ... } — the .xflow shape, verbatim
  graph                jsonb NOT NULL,
  -- derived from the graph's one `xeno-platform-trigger` node on every save (null = no workspace event)
  trigger_event        text CHECK (trigger_event IN ('task.status_changed', 'support.ticket_created', 'form.response_submitted', 'schedule', 'webhook')),
  trigger_config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- the capabilities the graph's workspace actions call: exactly what its agent is granted, and its run keys' scopes
  capabilities         text[] NOT NULL DEFAULT '{}',
  scopes               text[] NOT NULL DEFAULT '{}',
  -- draft: anyone allowed to write it (an agent too) · enabled: a HUMAN admin turned it on · disabled: off, with a reason
  state                text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'enabled', 'disabled')),
  disabled_reason      text,
  failure_threshold    integer NOT NULL DEFAULT 5 CHECK (failure_threshold BETWEEN 1 AND 100),
  consecutive_failures integer NOT NULL DEFAULT 0,
  webhook_secret_enc   text,
  next_run_at          timestamptz,
  -- the workflow's own platform agent: its grants are this workflow's capabilities in this workspace, nothing else
  agent_user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by_kind      text NOT NULL DEFAULT 'human' CHECK (created_by_kind IN ('human', 'agent')),
  updated_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  enabled_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  enabled_at           timestamptz,
  revision             integer NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  -- an enabled workflow always names the person it runs for
  CHECK (state <> 'enabled' OR (enabled_by IS NOT NULL AND agent_user_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS workspace_workflows_ws ON workspace_workflows (workspace_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS workspace_workflows_event ON workspace_workflows (workspace_id, trigger_event) WHERE state = 'enabled' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS workspace_workflows_due ON workspace_workflows (next_run_at) WHERE state = 'enabled' AND deleted_at IS NULL AND next_run_at IS NOT NULL;

-- Agents propose, humans ratify: whoever writes the row, the person who ENABLES a workflow is never an agent.
CREATE OR REPLACE FUNCTION workspace_workflows_human_enabler() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'enabled' AND (TG_OP = 'INSERT' OR OLD.state IS DISTINCT FROM 'enabled' OR OLD.enabled_by IS DISTINCT FROM NEW.enabled_by)
     AND EXISTS (SELECT 1 FROM agent_identities WHERE user_id = NEW.enabled_by) THEN
    RAISE EXCEPTION 'a workflow is enabled by a person, never an agent' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_workflows_human_enabler ON workspace_workflows;
CREATE TRIGGER workspace_workflows_human_enabler BEFORE INSERT OR UPDATE ON workspace_workflows
  FOR EACH ROW EXECUTE FUNCTION workspace_workflows_human_enabler();

CREATE TABLE IF NOT EXISTS workspace_workflow_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id     uuid NOT NULL REFERENCES workspace_workflows(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- idempotency: one run per trigger event, however often its source fires
  event_key       text NOT NULL CHECK (char_length(event_key) BETWEEN 1 AND 300),
  trigger_event   text NOT NULL,
  input           jsonb NOT NULL DEFAULT '{}'::jsonb,
  graph_revision  integer NOT NULL,
  -- queued → running → succeeded | failed ; a delivery that cannot reach the runner backs off, then goes dead
  state           text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'dead', 'discarded')),
  attempt         integer NOT NULL DEFAULT 0,
  available_at    timestamptz NOT NULL DEFAULT now(),
  lease_until     timestamptz,
  leased_by       text,
  -- the run's ONE scoped key, reused across delivery attempts so its idempotency keys dedupe on one connection;
  -- encrypted at rest (secretBox), revoked and cleared the moment the run ends
  key_id          uuid,
  key_enc         text,
  execution_id    text,
  resumed         boolean NOT NULL DEFAULT false,
  steps           jsonb NOT NULL DEFAULT '[]'::jsonb,
  error           text,
  error_code      text,
  requested_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  UNIQUE (workflow_id, event_key)
);
CREATE INDEX IF NOT EXISTS workspace_workflow_runs_due ON workspace_workflow_runs (available_at) WHERE state IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS workspace_workflow_runs_list ON workspace_workflow_runs (workflow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS workspace_workflow_runs_ws ON workspace_workflow_runs (workspace_id, created_at DESC);
-- DOWN
DROP INDEX IF EXISTS workspace_workflow_runs_ws;
DROP INDEX IF EXISTS workspace_workflow_runs_list;
DROP INDEX IF EXISTS workspace_workflow_runs_due;
DROP TABLE IF EXISTS workspace_workflow_runs;
DROP TRIGGER IF EXISTS workspace_workflows_human_enabler ON workspace_workflows;
DROP FUNCTION IF EXISTS workspace_workflows_human_enabler();
DROP INDEX IF EXISTS workspace_workflows_due;
DROP INDEX IF EXISTS workspace_workflows_event;
DROP INDEX IF EXISTS workspace_workflows_ws;
DROP TABLE IF EXISTS workspace_workflows;
