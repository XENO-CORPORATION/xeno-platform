-- UP
-- XENO Orchestrator on the platform (xeno-orchestrator/SPEC.md, owner-approved 2026-10-16) and the XENO-WORKFORCE-01
-- §15 typed workforce event stream. ADDITIVE ONLY.
--
-- The Orchestrator coordinates THROUGH the existing owners and stores no second work item, session or agent loop:
--   * a task→task dependency is the EXISTING task_links row of kind 'blocks' (from_task blocks to_task) -- never a
--     copy. orchestrator_edges holds only the edges Tasks cannot hold: those with a goal or an objective at one end.
--   * the graph (task_links.blocks ∪ orchestrator_edges) is acyclic, and the DATABASE refuses a cycle on BOTH tables,
--     under one advisory lock, so two concurrent inserts cannot close a loop between them.
--   * a plan names existing tasks of one project; its order is the graph, not a second ordering.
--   * an attempt is BOUND to one run admission (workforce_run_admissions). It stores no state: its state is derived
--     from the run's own rows (result → completed/failed/interrupted, fence → cancelled, else running).
--
-- workforce_events (§15): one typed, durable stream written by triggers ON THE OWNING TABLES, at the point of change,
-- inside the same transaction -- so no code path can change a run, lease, handoff, assignment, budget, contribution,
-- division or orchestrator record without its event, and a rolled-back change leaves none. Metadata and opaque ids
-- only (§15: no prompts, bodies, memory or credentials). Scope columns (workspace/division/project) are resolved at
-- write time; READ access is decided per row at read time (services/workforceEvents.js), never stored.
-- Lives outside the workforce migration chain on purpose: it depends on tasks and project_goals, which the chain
-- prelude does not model. Cited by src/server/tests/workforce-events.test.mjs and orchestrator.test.mjs.

CREATE TABLE IF NOT EXISTS orchestrator_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_kind TEXT NOT NULL CHECK (from_kind IN ('task','goal','objective')),
  from_id UUID NOT NULL,
  to_kind TEXT NOT NULL CHECK (to_kind IN ('task','goal','objective')),
  to_id UUID NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT (from_kind = 'task' AND to_kind = 'task')),   -- task→task lives in task_links, once
  CHECK (NOT (from_kind = to_kind AND from_id = to_id)),
  UNIQUE (from_kind, from_id, to_kind, to_id)
);
CREATE INDEX IF NOT EXISTS orchestrator_edges_to ON orchestrator_edges (to_kind, to_id);

-- every dependency edge, blocker → blocked
CREATE OR REPLACE VIEW orchestrator_graph_edges AS
  SELECT 'task'::text AS from_kind, from_task AS from_id, 'task'::text AS to_kind, to_task AS to_id FROM task_links WHERE kind = 'blocks'
  UNION ALL SELECT from_kind, from_id, to_kind, to_id FROM orchestrator_edges;

CREATE OR REPLACE FUNCTION orchestrator_reaches(a_kind text, a_id uuid, b_kind text, b_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  WITH RECURSIVE walk(k, i) AS (
    SELECT a_kind, a_id
    UNION
    SELECT e.to_kind, e.to_id FROM orchestrator_graph_edges e JOIN walk w ON e.from_kind = w.k AND e.from_id = w.i
  ) SELECT EXISTS (SELECT 1 FROM walk WHERE k = b_kind AND i = b_id)
$$;

CREATE OR REPLACE FUNCTION orchestrator_refuse_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fk text; fi uuid; tk text; ti uuid;
BEGIN
  IF TG_TABLE_NAME = 'task_links' THEN
    IF NEW.kind <> 'blocks' THEN RETURN NEW; END IF;
    fk := 'task'; fi := NEW.from_task; tk := 'task'; ti := NEW.to_task;
  ELSE fk := NEW.from_kind; fi := NEW.from_id; tk := NEW.to_kind; ti := NEW.to_id; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('orchestrator-graph', 0));
  -- adding from→to closes a loop exactly when `to` already reaches `from`
  IF orchestrator_reaches(tk, ti, fk, fi) THEN
    RAISE EXCEPTION 'orchestrator_cycle: % % already depends on % %', fk, fi, tk, ti USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS task_links_refuse_cycle ON task_links;
CREATE TRIGGER task_links_refuse_cycle BEFORE INSERT ON task_links FOR EACH ROW EXECUTE FUNCTION orchestrator_refuse_cycle();
DROP TRIGGER IF EXISTS orchestrator_edges_refuse_cycle ON orchestrator_edges;
CREATE TRIGGER orchestrator_edges_refuse_cycle BEFORE INSERT ON orchestrator_edges FOR EACH ROW EXECUTE FUNCTION orchestrator_refuse_cycle();

CREATE TABLE IF NOT EXISTS orchestrator_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','closed')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orchestrator_plans_project ON orchestrator_plans (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS orchestrator_plan_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES orchestrator_plans(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  UNIQUE (plan_id, task_id)
);
CREATE OR REPLACE FUNCTION orchestrator_step_same_project() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tasks t JOIN orchestrator_plans p ON p.id = NEW.plan_id WHERE t.id = NEW.task_id AND t.project_id = p.project_id) THEN
    RAISE EXCEPTION 'a plan step is a task of the plan''s own project' USING ERRCODE = '23514';
  END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS orchestrator_step_same_project ON orchestrator_plan_steps;
CREATE TRIGGER orchestrator_step_same_project BEFORE INSERT ON orchestrator_plan_steps FOR EACH ROW EXECUTE FUNCTION orchestrator_step_same_project();

CREATE TABLE IF NOT EXISTS orchestrator_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id UUID NOT NULL REFERENCES orchestrator_plan_steps(id) ON DELETE RESTRICT,
  attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 10),
  admission_id UUID NOT NULL UNIQUE REFERENCES workforce_run_admissions(id) ON DELETE RESTRICT,
  started_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (step_id, attempt)
);
-- the run an attempt binds to is a run ON the plan's project, by the person starting the attempt; and the attempt
-- number never exceeds the step's ceiling. Immutable once written.
CREATE OR REPLACE FUNCTION orchestrator_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s record; a record;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'an attempt is immutable' USING ERRCODE = '23514'; END IF;
  SELECT st.max_attempts, p.project_id INTO s FROM orchestrator_plan_steps st JOIN orchestrator_plans p ON p.id = st.plan_id WHERE st.id = NEW.step_id;
  SELECT project_id, actor_user_id INTO a FROM workforce_run_admissions WHERE id = NEW.admission_id;
  IF a.project_id IS DISTINCT FROM s.project_id THEN RAISE EXCEPTION 'an attempt''s run is admitted on the plan''s project' USING ERRCODE = '23514'; END IF;
  IF NEW.started_by IS NOT NULL AND a.actor_user_id <> NEW.started_by THEN RAISE EXCEPTION 'an attempt binds a run its starter admitted' USING ERRCODE = '23514'; END IF;
  IF NEW.attempt > s.max_attempts THEN RAISE EXCEPTION 'attempt exceeds the step''s ceiling' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS orchestrator_attempt_guard ON orchestrator_attempts;
CREATE TRIGGER orchestrator_attempt_guard BEFORE INSERT OR UPDATE ON orchestrator_attempts FOR EACH ROW EXECUTE FUNCTION orchestrator_attempt_guard();

-- ─────────────────────────────── §15 workforce events
CREATE TABLE IF NOT EXISTS workforce_events (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type ~ '^[a-z]+(\.[a-z_]+)+$'),
  subject_kind TEXT NOT NULL,
  subject_id UUID NOT NULL,
  actor_user_id UUID,
  workspace_id UUID,
  division_id UUID,
  project_id UUID,
  data JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 4096),
  at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS workforce_events_workspace ON workforce_events (workspace_id, id DESC) WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS workforce_events_division ON workforce_events (division_id, id DESC) WHERE division_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS workforce_events_project ON workforce_events (project_id, id DESC) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS workforce_events_actor ON workforce_events (actor_user_id, id DESC);
CREATE OR REPLACE FUNCTION workforce_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'workforce_events is append-only' USING ERRCODE = '23514'; END $$;
DROP TRIGGER IF EXISTS workforce_events_append_only ON workforce_events;
CREATE TRIGGER workforce_events_append_only BEFORE UPDATE OR DELETE ON workforce_events FOR EACH ROW EXECUTE FUNCTION workforce_events_append_only();

-- scope of a project: its workspace (NULL for a personal project) and its owning division
CREATE OR REPLACE FUNCTION workforce_event_emit(p_type text, p_kind text, p_id uuid, p_actor uuid, p_ws uuid, p_div uuid, p_project uuid, p_data jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE ws uuid := p_ws; dv uuid := p_div;
BEGIN
  IF p_project IS NOT NULL THEN
    IF ws IS NULL THEN SELECT workspace_id INTO ws FROM chat_projects WHERE id = p_project; END IF;
    IF dv IS NULL THEN SELECT division_id INTO dv FROM workforce_project_divisions WHERE project_id = p_project; END IF;
  END IF;
  IF dv IS NOT NULL AND ws IS NULL THEN SELECT workspace_id INTO ws FROM workforce_divisions WHERE id = dv; END IF;
  INSERT INTO workforce_events (type, subject_kind, subject_id, actor_user_id, workspace_id, division_id, project_id, data)
    VALUES (p_type, p_kind, p_id, p_actor, ws, dv, p_project, COALESCE(p_data, '{}'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION orchestrator_node_scope(k text, i uuid, OUT project_id uuid, OUT workspace_id uuid, OUT division_id uuid) LANGUAGE sql STABLE AS $$
  SELECT CASE k WHEN 'task' THEN (SELECT t.project_id FROM tasks t WHERE t.id = i) WHEN 'goal' THEN (SELECT g.project_id FROM project_goals g WHERE g.id = i) END,
         CASE k WHEN 'objective' THEN (SELECT o.workspace_id FROM project_objectives o WHERE o.id = i) END,
         CASE k WHEN 'objective' THEN (SELECT o.division_id FROM project_objectives o WHERE o.id = i) END
$$;

CREATE OR REPLACE FUNCTION workforce_event_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a record; t record; changed boolean := TG_OP = 'INSERT';
BEGIN
  CASE TG_TABLE_NAME
  WHEN 'workforce_run_admissions' THEN
    PERFORM workforce_event_emit('run.admitted', 'run', NEW.id, NEW.actor_user_id, NEW.target_workspace_id, NULL, NEW.project_id,
      jsonb_build_object('agentResourceId', NEW.agent_resource_id, 'agentVersion', NEW.agent_version, 'targetKind', NEW.target_kind, 'payerUserId', NEW.payer_user_id, 'budgetCeilingMicro', NEW.budget_ceiling_micro::text));
  WHEN 'workforce_run_revocations' THEN
    SELECT * INTO a FROM workforce_run_admissions WHERE id = NEW.admission_id;
    PERFORM workforce_event_emit('run.revoked', 'run', NEW.admission_id, NEW.revoked_by_user_id, a.target_workspace_id, NULL, a.project_id, jsonb_build_object('reason', NEW.reason));
  WHEN 'workforce_run_leases' THEN
    SELECT * INTO a FROM workforce_run_admissions WHERE id = NEW.admission_id;
    PERFORM workforce_event_emit('run.lease_issued', 'run', NEW.admission_id, a.actor_user_id, a.target_workspace_id, NULL, a.project_id,
      jsonb_build_object('leaseId', NEW.id, 'sequence', NEW.sequence::text, 'operation', NEW.operation, 'capability', NEW.capability, 'expiresAt', NEW.expires_at));
  WHEN 'workforce_run_results' THEN
    SELECT * INTO a FROM workforce_run_admissions WHERE id = NEW.admission_id;
    PERFORM workforce_event_emit('run.result_reported', 'run', NEW.admission_id, NEW.reported_by_user_id, a.target_workspace_id, NULL, a.project_id,
      jsonb_build_object('outcome', NEW.outcome, 'interruptedReason', NEW.interrupted_reason, 'reportHash', NEW.report_hash));
  WHEN 'workforce_handoffs' THEN
    IF changed OR NEW.state IS DISTINCT FROM OLD.state THEN
      PERFORM workforce_event_emit('handoff.' || NEW.state, 'handoff', NEW.id, NEW.source_principal_id, COALESCE(NEW.target_workspace_id, NEW.source_workspace_id), COALESCE(NEW.target_division_id, NEW.source_division_id),
        CASE WHEN NEW.work_ref_type = 'project' THEN NEW.work_ref_id END,
        jsonb_build_object('sourcePrincipalId', NEW.source_principal_id, 'targetPrincipalId', NEW.target_principal_id, 'workRefType', NEW.work_ref_type, 'workRefId', NEW.work_ref_id, 'revision', NEW.revision::text));
    END IF;
  WHEN 'workforce_workspace_assignments' THEN
    IF changed OR NEW.state IS DISTINCT FROM OLD.state THEN
      PERFORM workforce_event_emit('assignment.' || NEW.state, 'assignment', NEW.id, COALESCE(NEW.target_accepted_by_user_id, NEW.created_by_user_id), NEW.workspace_id, NULL, NULL,
        jsonb_build_object('resourceId', NEW.resource_id, 'resourceKind', NEW.resource_kind, 'revision', NEW.revision::text));
    END IF;
  WHEN 'workforce_funding_budgets' THEN
    IF changed OR NEW.state IS DISTINCT FROM OLD.state THEN
      SELECT project_id INTO t FROM workforce_funding_pools WHERE id = NEW.pool_id;
      PERFORM workforce_event_emit('funding.budget_' || NEW.state, 'funding_budget', NEW.id, COALESCE(NEW.decided_by_user_id, NEW.proposed_by_user_id), NULL, NULL, t.project_id,
        jsonb_build_object('poolId', NEW.pool_id, 'spenderUserId', NEW.spender_user_id, 'maximumMicro', NEW.maximum_micro::text, 'revision', NEW.revision::text));
    END IF;
  WHEN 'workforce_funding_contributions' THEN
    IF changed OR NEW.state IS DISTINCT FROM OLD.state THEN
      SELECT project_id INTO t FROM workforce_funding_campaigns WHERE id = NEW.campaign_id;
      PERFORM workforce_event_emit('funding.contribution_' || NEW.state, 'funding_contribution', NEW.id, NEW.contributor_user_id, NULL, NULL, t.project_id,
        jsonb_build_object('campaignId', NEW.campaign_id, 'milestoneId', NEW.milestone_id));
    END IF;
  WHEN 'workforce_divisions' THEN
    IF changed THEN
      PERFORM workforce_event_emit('division.created', 'division', NEW.id, NEW.created_by_user_id, NEW.workspace_id, NEW.id, NULL, jsonb_build_object('parentId', NEW.parent_division_id, 'revision', NEW.revision::text));
    ELSIF NEW.lifecycle IS DISTINCT FROM OLD.lifecycle AND NEW.lifecycle = 'archived' THEN
      PERFORM workforce_event_emit('division.archived', 'division', NEW.id, NULL, NEW.workspace_id, NEW.id, NULL, jsonb_build_object('revision', NEW.revision::text));
    ELSIF NEW.revision IS DISTINCT FROM OLD.revision THEN
      PERFORM workforce_event_emit('division.updated', 'division', NEW.id, NULL, NEW.workspace_id, NEW.id, NULL,
        jsonb_build_object('revision', NEW.revision::text, 'headChanged', NEW.head_principal_id IS DISTINCT FROM OLD.head_principal_id, 'parentChanged', NEW.parent_division_id IS DISTINCT FROM OLD.parent_division_id));
    END IF;
  WHEN 'orchestrator_plans' THEN
    PERFORM workforce_event_emit('orchestrator.plan_created', 'plan', NEW.id, NEW.created_by, NULL, NULL, NEW.project_id, '{}'::jsonb);
  WHEN 'orchestrator_attempts' THEN
    SELECT p.project_id, p.id AS plan_id, st.task_id INTO t FROM orchestrator_plan_steps st JOIN orchestrator_plans p ON p.id = st.plan_id WHERE st.id = NEW.step_id;
    PERFORM workforce_event_emit('orchestrator.attempt_started', 'attempt', NEW.id, NEW.started_by, NULL, NULL, t.project_id,
      jsonb_build_object('planId', t.plan_id, 'taskId', t.task_id, 'attempt', NEW.attempt, 'admissionId', NEW.admission_id));
  WHEN 'orchestrator_edges' THEN
    -- scoped to the BLOCKED end: its project (task, goal) or its workspace and division (objective)
    SELECT * INTO t FROM orchestrator_node_scope(CASE WHEN TG_OP = 'DELETE' THEN OLD.to_kind ELSE NEW.to_kind END, CASE WHEN TG_OP = 'DELETE' THEN OLD.to_id ELSE NEW.to_id END);
    PERFORM workforce_event_emit(CASE WHEN TG_OP = 'DELETE' THEN 'orchestrator.edge_removed' ELSE 'orchestrator.edge_added' END, 'edge',
      CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END, CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.created_by END,
      t.workspace_id, t.division_id, t.project_id, jsonb_build_object('from', CASE WHEN TG_OP = 'DELETE' THEN OLD.from_kind || ':' || OLD.from_id ELSE NEW.from_kind || ':' || NEW.from_id END,
                                           'to', CASE WHEN TG_OP = 'DELETE' THEN OLD.to_kind || ':' || OLD.to_id ELSE NEW.to_kind || ':' || NEW.to_id END));
  WHEN 'task_links' THEN
    IF TG_OP = 'DELETE' THEN
      IF OLD.kind = 'blocks' THEN
        SELECT project_id INTO t FROM tasks WHERE id = OLD.to_task;
        PERFORM workforce_event_emit('orchestrator.edge_removed', 'edge', OLD.id, NULL, NULL, NULL, t.project_id, jsonb_build_object('from', 'task:' || OLD.from_task, 'to', 'task:' || OLD.to_task));
      END IF;
    ELSIF NEW.kind = 'blocks' THEN
      SELECT project_id INTO t FROM tasks WHERE id = NEW.to_task;
      PERFORM workforce_event_emit('orchestrator.edge_added', 'edge', NEW.id, NEW.created_by, NULL, NULL, t.project_id, jsonb_build_object('from', 'task:' || NEW.from_task, 'to', 'task:' || NEW.to_task));
    END IF;
  END CASE;
  RETURN NULL;
END $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['workforce_run_admissions','workforce_run_revocations','workforce_run_leases','workforce_run_results','orchestrator_plans','orchestrator_attempts'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_event', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON %I FOR EACH ROW EXECUTE FUNCTION workforce_event_capture()', t || '_event', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['workforce_handoffs','workforce_workspace_assignments','workforce_funding_budgets','workforce_funding_contributions','workforce_divisions'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_event', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION workforce_event_capture()', t || '_event', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['orchestrator_edges','task_links'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_event', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION workforce_event_capture()', t || '_event', t);
  END LOOP;
END $$;

-- DOWN
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['workforce_run_admissions','workforce_run_revocations','workforce_run_leases','workforce_run_results','workforce_handoffs','workforce_workspace_assignments','workforce_funding_budgets','workforce_funding_contributions','workforce_divisions','task_links'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_event', t);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS task_links_refuse_cycle ON task_links;
DROP TABLE IF EXISTS workforce_events;
DROP TABLE IF EXISTS orchestrator_attempts;
DROP TABLE IF EXISTS orchestrator_plan_steps;
DROP TABLE IF EXISTS orchestrator_plans;
DROP VIEW IF EXISTS orchestrator_graph_edges;
DROP TABLE IF EXISTS orchestrator_edges;
DROP FUNCTION IF EXISTS workforce_event_capture();
DROP FUNCTION IF EXISTS workforce_event_emit(text, text, uuid, uuid, uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS workforce_events_append_only();
DROP FUNCTION IF EXISTS orchestrator_attempt_guard();
DROP FUNCTION IF EXISTS orchestrator_step_same_project();
DROP FUNCTION IF EXISTS orchestrator_refuse_cycle();
DROP FUNCTION IF EXISTS orchestrator_node_scope(text, uuid);
DROP FUNCTION IF EXISTS orchestrator_reaches(text, uuid, text, uuid);
