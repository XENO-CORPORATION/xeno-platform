-- UP
-- XENO-WORKFORCE-01 RUN-04 -- what a child run is for, what it produced, and its delivery to its parent.
--
--   RUN-04: "Children inherit a subset of the parent's authorized context, not all memberships or
--            credentials. Persist parent/task/session IDs, results, artifacts, delivery receipts and
--            explicit interrupted state. Result delivery is idempotent to the correct parent."
--
-- RUN-10 (20260927110000) made a child an admission with a parent. This file adds what a child is FOR
-- and what became of it:
--
--   task_ref      the task a run was admitted for -- an opaque id from the coordination subsystem, on the
--                 immutable admission beside the parent (parent_admission_id) and the session
--                 (conversation_id) it already carries. Parent, task and session are one row.
--   results       one per run, immutable: completed, failed, or INTERRUPTED with a closed reason. A summary
--                 and artifact REFERENCES (name, ref, optional sha256) -- never artifact content.
--   deliveries    one per child, immutable: the receipt that its result reached ITS parent. The child is the
--                 key, so a result is delivered at most once; the parent is checked against the child's own
--                 parent edge, so it can only be delivered to that parent.
--
-- ── "EXPLICIT INTERRUPTED STATE" ─────────────────────────────────────────────────────────────────
-- A run that stopped without reporting must not read as still running, and must not read as done. So
-- interruption is explicit in two ways: a runtime may report it with a reason (RUN-07's durable
-- reasons: budget exhausted, stopped, authority lost, unresolved uncertainty, a genuine blocker), and a
-- run that is FENCED (RUN-10) with no report reads as interrupted, with the fence's reason, at read time.
-- Delivering such a run records the interruption in its receipt -- and after that no late report can be
-- written for it, because what the parent consumed is what the record says.
--
-- ── "A SUBSET OF THE PARENT'S AUTHORIZED CONTEXT" ────────────────────────────────────────────────
-- RUN-10 already holds actor, client, payer, target and capabilities. The one credential it did not hold
-- is the ROOT: a child of a project run could name a different host root than its parent had. The
-- envelope guard now refuses a child root other than the parent's own, or none.

ALTER TABLE workforce_run_admissions
  ADD COLUMN task_ref TEXT CHECK (task_ref IS NULL OR task_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$');
COMMENT ON COLUMN workforce_run_admissions.task_ref IS
  'RUN-04: the coordination task this run was admitted for (opaque). With parent_admission_id and conversation_id, the parent/task/session ids.';

CREATE OR REPLACE FUNCTION workforce_run_envelope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p workforce_run_admissions%ROWTYPE; carved NUMERIC;
BEGIN
  IF NEW.parent_admission_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO p FROM workforce_run_admissions WHERE id = NEW.parent_admission_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'a child run names a parent that does not exist' USING ERRCODE = '23503'; END IF;
  IF workforce_run_admission_fence(p.id) IS NOT NULL THEN
    RAISE EXCEPTION 'a revoked run spawns nothing' USING ERRCODE = '23514';
  END IF;
  IF NEW.nesting_depth <> p.nesting_depth + 1 THEN
    RAISE EXCEPTION 'a child sits exactly one level below its parent' USING ERRCODE = '23514';
  END IF;
  IF NEW.actor_user_id <> p.actor_user_id OR NEW.client_id <> p.client_id OR NEW.payer_user_id <> p.payer_user_id
     OR NEW.target_kind <> p.target_kind
     OR NEW.target_owner_user_id IS DISTINCT FROM p.target_owner_user_id OR NEW.target_workspace_id IS DISTINCT FROM p.target_workspace_id
     OR NEW.project_id IS DISTINCT FROM p.project_id OR NEW.assignment_id IS DISTINCT FROM p.assignment_id
     OR NEW.participation_id IS DISTINCT FROM p.participation_id THEN
    RAISE EXCEPTION 'a child runs for its parent''s actor, payer and target' USING ERRCODE = '23514';
  END IF;
  IF NOT (NEW.effective_capabilities <@ p.effective_capabilities) THEN
    RAISE EXCEPTION 'a child may do nothing its parent may not' USING ERRCODE = '23514';
  END IF;
  -- RUN-04: the root is a credential too. A child works in its parent's root, or in none.
  IF NEW.root_binding_id IS NOT NULL AND (NEW.root_binding_id IS DISTINCT FROM p.root_binding_id
     OR NEW.host_installation_id IS DISTINCT FROM p.host_installation_id) THEN
    RAISE EXCEPTION 'a child works in its parent''s root, or in none' USING ERRCODE = '23514';
  END IF;
  SELECT coalesce(sum(budget_ceiling_micro), 0) INTO carved FROM workforce_run_admissions WHERE parent_admission_id = p.id;
  IF carved + NEW.budget_ceiling_micro > p.budget_ceiling_micro THEN
    RAISE EXCEPTION 'a child sub-reservation exceeds the remaining parent envelope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE workforce_run_results (
  admission_id UUID PRIMARY KEY REFERENCES workforce_run_admissions(id) ON DELETE RESTRICT,
  outcome TEXT NOT NULL CHECK (outcome IN ('completed','failed','interrupted')),
  -- RUN-07's durable reasons for work that stopped without finishing. Present exactly when interrupted.
  interrupted_reason TEXT CHECK (interrupted_reason IN ('budget_exhausted','stopped','authority_lost','uncertain','blocked')),
  -- Bounded. A NUL cannot reach it: PostgreSQL TEXT refuses the byte itself.
  summary TEXT NOT NULL DEFAULT '' CHECK (octet_length(summary) <= 16384),
  -- References only: { name, ref, sha256? }. An artifact's content lives where the artifact lives.
  artifacts JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(artifacts) = 'array' AND jsonb_array_length(artifacts) <= 64),
  report_hash TEXT NOT NULL CHECK (report_hash ~ '^[0-9a-f]{64}$'),
  reported_by_user_id UUID,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT workforce_run_result_interruption CHECK ((outcome = 'interrupted') = (interrupted_reason IS NOT NULL))
);
COMMENT ON TABLE workforce_run_results IS
  'RUN-04: what one run produced -- completed, failed or explicitly interrupted, with artifact references. One per run. Immutable.';

CREATE TABLE workforce_run_result_deliveries (
  child_admission_id UUID PRIMARY KEY REFERENCES workforce_run_admissions(id) ON DELETE RESTRICT,
  parent_admission_id UUID NOT NULL REFERENCES workforce_run_admissions(id) ON DELETE RESTRICT,
  -- What the parent received, fixed at delivery: a reported result, or an interruption read from a fence.
  delivered_outcome TEXT NOT NULL CHECK (delivered_outcome IN ('completed','failed','interrupted')),
  delivered_reason TEXT CHECK (delivered_reason IN ('budget_exhausted','stopped','authority_lost','uncertain','blocked')),
  delivered_by_user_id UUID,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT workforce_run_delivery_interruption CHECK ((delivered_outcome = 'interrupted') = (delivered_reason IS NOT NULL)),
  CONSTRAINT workforce_run_delivery_not_self CHECK (child_admission_id <> parent_admission_id)
);
CREATE INDEX workforce_run_result_deliveries_parent ON workforce_run_result_deliveries(parent_admission_id);
COMMENT ON TABLE workforce_run_result_deliveries IS
  'RUN-04: the receipt that a child''s result reached ITS parent. One per child, so delivery happens at most once. Immutable.';

-- A result is written once, and never after its run's delivery was already decided from a fence.
CREATE FUNCTION workforce_run_result_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM workforce_run_result_deliveries WHERE child_admission_id = NEW.admission_id) THEN
    RAISE EXCEPTION 'this run''s result was already delivered to its parent' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workforce_run_results_guard BEFORE INSERT ON workforce_run_results
  FOR EACH ROW EXECUTE FUNCTION workforce_run_result_guard();

-- A delivery goes to the child's OWN parent, and says what the record says: the reported result, or --
-- when nothing was reported and the run is fenced -- an interruption with the fence's reason.
CREATE FUNCTION workforce_run_delivery_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE child workforce_run_admissions%ROWTYPE; res workforce_run_results%ROWTYPE; fence UUID; fenced_reason TEXT;
BEGIN
  SELECT * INTO child FROM workforce_run_admissions WHERE id = NEW.child_admission_id FOR KEY SHARE;
  IF NOT FOUND OR child.parent_admission_id IS DISTINCT FROM NEW.parent_admission_id THEN
    RAISE EXCEPTION 'a result is delivered only to its own parent' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO res FROM workforce_run_results WHERE admission_id = NEW.child_admission_id;
  IF FOUND THEN
    IF NEW.delivered_outcome <> res.outcome OR NEW.delivered_reason IS DISTINCT FROM res.interrupted_reason THEN
      RAISE EXCEPTION 'a delivery carries the result that was reported' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  fence := workforce_run_admission_fence(NEW.child_admission_id);
  IF fence IS NULL THEN
    RAISE EXCEPTION 'a run with no result and no fence has nothing to deliver yet' USING ERRCODE = '23514';
  END IF;
  SELECT CASE reason WHEN 'authority_lost' THEN 'authority_lost' ELSE 'stopped' END INTO fenced_reason
    FROM workforce_run_revocations WHERE admission_id = fence;
  IF NEW.delivered_outcome <> 'interrupted' OR NEW.delivered_reason IS DISTINCT FROM fenced_reason THEN
    RAISE EXCEPTION 'an unreported fenced run is delivered as interrupted, for the fence''s reason' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workforce_run_result_deliveries_guard BEFORE INSERT ON workforce_run_result_deliveries
  FOR EACH ROW EXECUTE FUNCTION workforce_run_delivery_guard();

CREATE FUNCTION workforce_run_outcome_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'run results and deliveries are immutable and retained' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER workforce_run_results_immutable BEFORE UPDATE OR DELETE ON workforce_run_results
  FOR EACH ROW EXECUTE FUNCTION workforce_run_outcome_immutable();
CREATE TRIGGER workforce_run_results_no_truncate BEFORE TRUNCATE ON workforce_run_results
  FOR EACH STATEMENT EXECUTE FUNCTION workforce_run_outcome_immutable();
CREATE TRIGGER workforce_run_result_deliveries_immutable BEFORE UPDATE OR DELETE ON workforce_run_result_deliveries
  FOR EACH ROW EXECUTE FUNCTION workforce_run_outcome_immutable();
CREATE TRIGGER workforce_run_result_deliveries_no_truncate BEFORE TRUNCATE ON workforce_run_result_deliveries
  FOR EACH STATEMENT EXECUTE FUNCTION workforce_run_outcome_immutable();

DO $harden$
BEGIN
  EXECUTE format('ALTER FUNCTION %I.workforce_run_envelope_guard() SET search_path = %I, pg_temp', current_schema(), current_schema());
  EXECUTE format('ALTER FUNCTION %I.workforce_run_result_guard() SET search_path = %I, pg_temp', current_schema(), current_schema());
  EXECUTE format('ALTER FUNCTION %I.workforce_run_delivery_guard() SET search_path = %I, pg_temp', current_schema(), current_schema());
  EXECUTE format('ALTER FUNCTION %I.workforce_run_outcome_immutable() SET search_path = %I, pg_temp', current_schema(), current_schema());
END $harden$;

-- DOWN
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM workforce_run_results) OR EXISTS (SELECT 1 FROM workforce_run_result_deliveries)
     OR EXISTS (SELECT 1 FROM workforce_run_admissions WHERE task_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'run results rollback refused: retained results, deliveries or task references exist' USING ERRCODE = '23514';
  END IF;
END $$;
DROP TABLE workforce_run_result_deliveries;
DROP TABLE workforce_run_results;
DROP FUNCTION workforce_run_delivery_guard();
DROP FUNCTION workforce_run_result_guard();
DROP FUNCTION workforce_run_outcome_immutable();
CREATE OR REPLACE FUNCTION workforce_run_envelope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p workforce_run_admissions%ROWTYPE; carved NUMERIC;
BEGIN
  IF NEW.parent_admission_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO p FROM workforce_run_admissions WHERE id = NEW.parent_admission_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'a child run names a parent that does not exist' USING ERRCODE = '23503'; END IF;
  IF workforce_run_admission_fence(p.id) IS NOT NULL THEN
    RAISE EXCEPTION 'a revoked run spawns nothing' USING ERRCODE = '23514';
  END IF;
  IF NEW.nesting_depth <> p.nesting_depth + 1 THEN
    RAISE EXCEPTION 'a child sits exactly one level below its parent' USING ERRCODE = '23514';
  END IF;
  IF NEW.actor_user_id <> p.actor_user_id OR NEW.client_id <> p.client_id OR NEW.payer_user_id <> p.payer_user_id
     OR NEW.target_kind <> p.target_kind
     OR NEW.target_owner_user_id IS DISTINCT FROM p.target_owner_user_id OR NEW.target_workspace_id IS DISTINCT FROM p.target_workspace_id
     OR NEW.project_id IS DISTINCT FROM p.project_id OR NEW.assignment_id IS DISTINCT FROM p.assignment_id
     OR NEW.participation_id IS DISTINCT FROM p.participation_id THEN
    RAISE EXCEPTION 'a child runs for its parent''s actor, payer and target' USING ERRCODE = '23514';
  END IF;
  IF NOT (NEW.effective_capabilities <@ p.effective_capabilities) THEN
    RAISE EXCEPTION 'a child may do nothing its parent may not' USING ERRCODE = '23514';
  END IF;
  SELECT coalesce(sum(budget_ceiling_micro), 0) INTO carved FROM workforce_run_admissions WHERE parent_admission_id = p.id;
  IF carved + NEW.budget_ceiling_micro > p.budget_ceiling_micro THEN
    RAISE EXCEPTION 'a child sub-reservation exceeds the remaining parent envelope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DO $harden$
BEGIN
  EXECUTE format('ALTER FUNCTION %I.workforce_run_envelope_guard() SET search_path = %I, pg_temp', current_schema(), current_schema());
END $harden$;
ALTER TABLE workforce_run_admissions DROP COLUMN task_ref;
