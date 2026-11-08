-- UP
-- XENO-WORKFORCE-01 RUN-11 -- every step the platform REFUSED a run, kept beside the leases it granted.
--
--   RUN-11: "Every refused step of an admitted run is retained: operation, capability, typed reason,
--            whether and how the run can resume (RUN-07), and when, ordered among the run's leases and
--            readable by whoever may read its steps. Identical refusals between two leases are one record
--            with a count and a last time. A refusal never reveals a run to a caller that is not its
--            actor, and malformed requests are not a run's refusals. A run admitted before refusals were
--            kept says its list may be incomplete."
--
-- Until this file a refused step rolled back with its transaction: only a terminal loss left a trace,
-- as the revocation (20260925140000). A Runs screen could therefore show what a run was ALLOWED to do
-- and nothing of what it was stopped from doing, and an empty list could not be told from "nothing was
-- refused". Owner decision, 2026-11-08: "Save every refusal".
--
-- ONE ROW PER (admission, place among the leases, operation, capability, reason). A runtime that keeps
-- asking for the same thing between two leases -- a run waiting on a top-up, a worker retrying a
-- withdrawn capability -- would otherwise write a row per attempt for as long as it retries. The repeat
-- is counted instead: the first and the last time, and how many. Nothing else about a row ever changes.
--
-- WHERE IT SITS AMONG THE LEASES is set by the database, not by the writer: `after_sequence` is the
-- admission's latest lease sequence at the moment of the refusal (0 before the first lease), so the
-- record cannot be placed anywhere it did not happen.

CREATE TABLE workforce_run_step_refusals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id UUID NOT NULL REFERENCES workforce_run_admissions(id) ON DELETE RESTRICT,
  after_sequence BIGINT NOT NULL CHECK (after_sequence >= 0),
  operation TEXT NOT NULL CHECK (operation IN ('privileged_call','provider_dispatch')),
  capability TEXT CHECK (capability IS NULL OR capability ~ '^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,127}$'),
  -- The typed refusal as the runtime received it: the code class and the reason word. Closed shapes,
  -- never prose, so nothing a caller wrote can be stored here.
  code TEXT NOT NULL CHECK (code IN ('denied','needs_approval')),
  reason TEXT NOT NULL CHECK (reason ~ '^[a-z0-9_]{1,64}$'),
  -- RUN-07's two additive fields, or neither when the platform has not classified the reason.
  resumable BOOLEAN,
  resume TEXT CHECK (resume IS NULL OR resume IN
    ('fresh_lease','budget_top_up','different_model','settle_open_draws','different_capability','new_admission')),
  first_refused_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  last_refused_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  repeat_count BIGINT NOT NULL DEFAULT 1 CHECK (repeat_count >= 1),
  CONSTRAINT workforce_run_step_refusal_capability CHECK ((operation = 'privileged_call') = (capability IS NOT NULL)),
  CONSTRAINT workforce_run_step_refusal_resume CHECK ((resumable IS NULL) = (resume IS NULL)),
  CONSTRAINT workforce_run_step_refusal_times CHECK (last_refused_at >= first_refused_at),
  CONSTRAINT workforce_run_step_refusal_once UNIQUE NULLS NOT DISTINCT (admission_id, after_sequence, operation, capability, reason)
);
CREATE INDEX workforce_run_step_refusals_admission ON workforce_run_step_refusals(admission_id, after_sequence, first_refused_at);
COMMENT ON TABLE workforce_run_step_refusals IS
  'RUN-11: every refused step of an admitted run, placed among its leases; identical repeats counted. Only the count and last time ever change.';

CREATE FUNCTION workforce_run_step_refusal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- The place among the leases is a fact the database reads, never one a writer supplies.
    SELECT coalesce(max(sequence), 0) INTO NEW.after_sequence FROM workforce_run_leases WHERE admission_id = NEW.admission_id;
    NEW.first_refused_at := clock_timestamp();
    NEW.last_refused_at := NEW.first_refused_at;
    NEW.repeat_count := 1;
    RETURN NEW;
  END IF;
  -- UPDATE: one more of the same refusal, and nothing else.
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.admission_id IS DISTINCT FROM OLD.admission_id
     OR NEW.after_sequence IS DISTINCT FROM OLD.after_sequence OR NEW.operation IS DISTINCT FROM OLD.operation
     OR NEW.capability IS DISTINCT FROM OLD.capability OR NEW.code IS DISTINCT FROM OLD.code
     OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.resumable IS DISTINCT FROM OLD.resumable
     OR NEW.resume IS DISTINCT FROM OLD.resume OR NEW.first_refused_at IS DISTINCT FROM OLD.first_refused_at
     OR NEW.repeat_count <> OLD.repeat_count + 1 OR NEW.last_refused_at < OLD.last_refused_at THEN
    RAISE EXCEPTION 'a step refusal only counts a repeat' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workforce_run_step_refusals_guard BEFORE INSERT OR UPDATE ON workforce_run_step_refusals
  FOR EACH ROW EXECUTE FUNCTION workforce_run_step_refusal_guard();
CREATE TRIGGER workforce_run_step_refusals_no_delete BEFORE DELETE ON workforce_run_step_refusals
  FOR EACH ROW EXECUTE FUNCTION workforce_run_authority_immutable();
CREATE TRIGGER workforce_run_step_refusals_no_truncate BEFORE TRUNCATE ON workforce_run_step_refusals
  FOR EACH STATEMENT EXECUTE FUNCTION workforce_run_authority_immutable();

-- From when refusals are kept. A run admitted before this moment may have had refusals nobody stored,
-- and its answer must say so rather than show an empty list as complete. Fixed at migration time.
DO $since$
BEGIN
  EXECUTE format('CREATE FUNCTION %I.workforce_run_step_refusals_since() RETURNS timestamptz LANGUAGE sql IMMUTABLE AS %L',
    current_schema(), format('SELECT %L::timestamptz', clock_timestamp()));
  EXECUTE format('ALTER FUNCTION %I.workforce_run_step_refusal_guard() SET search_path = %I, pg_temp', current_schema(), current_schema());
END $since$;

-- DOWN
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM workforce_run_step_refusals) THEN
    RAISE EXCEPTION 'step refusal rollback refused: retained refusals exist' USING ERRCODE = '23514';
  END IF;
END $$;
DROP TABLE workforce_run_step_refusals;
DROP FUNCTION workforce_run_step_refusal_guard();
DROP FUNCTION workforce_run_step_refusals_since();
