-- UP
-- XENO-WORKFORCE-01 RUN-10 -- a nested run spends from its parent's envelope, never a copied ceiling.
--
--   RUN-10: "Nested runs share a parent budget through atomic child sub-reservations, not copied full
--            ceilings. Count each commitment once against the project and count every child in the
--            remaining parent envelope. Separate definition-version pinning from live permission
--            ceilings. Durable revocation epochs plus the admission lease fence stale workers; reconnect
--            cannot reset the lease without renewed authority."
--
-- A child run is an ADMISSION like any other (20260925130000) -- its own actor, agent version pin,
-- target and capabilities, resolved from authoritative state -- with one more term: the admission it
-- runs inside. This file adds that edge and the rules that make it a sub-reservation rather than a copy.
--
-- ── WHAT A CHILD IS BOUND BY, AND WHERE EACH RULE IS HELD ────────────────────────────────────────
--   envelope    Its ceiling is carved out of the parent's: the parent's ceiling less every child already
--               carved from it. Held HERE, in a trigger that locks the parent row, so two children racing
--               for the same remainder cannot both fit -- the second waits, then sees the first.
--               The same lock is taken first by the service, so the service's own check and this one
--               read one committed state.
--   counted     A revoked child STILL counts against its parent's envelope. There is no settlement record
--               yet that could prove its spend is final, and FUND-09 forbids releasing a reservation
--               because authority lapsed: a stale worker may still be finishing a dispatched call, and
--               handing its remainder to a sibling would let the same money be committed twice.
--   once        A child's ceiling is INSIDE its parent's, so only a ROOT admission is a commitment
--               against its scope. The capacity views below count roots; counting children too would
--               charge the same approved money two, three, eight times over.
--   subset      Its effective capabilities are inside the parent's, and its target IS the parent's
--               target, actor and payer: a child runs within the context it was spawned from.
--   fenced      A revocation of the child OR ANY ANCESTOR fences it. Derived at read time by
--               workforce_run_admission_fence(), never propagated by writing a revocation per child --
--               a write-time cascade is a step something can skip, and this estate has shipped exactly
--               that failure (a suspension that held on password login and not on OAuth).
--
-- "Separate definition-version pinning from live permission ceilings" is the service's half: a child
-- keeps its OWN agent version pin (a newer parent definition does not change the child, nor the
-- reverse), while every step it takes is authorized against its parent's LIVE authority as well as its
-- own (services/workforceRunAuthority.js). A pin says what runs; the live ceiling says how far.
--
-- Nesting depth is bounded at 8. The column carries the depth so the bound is a CHECK, not a walk.

ALTER TABLE workforce_run_admissions
  ADD COLUMN parent_admission_id UUID REFERENCES workforce_run_admissions(id) ON DELETE RESTRICT,
  ADD COLUMN nesting_depth SMALLINT NOT NULL DEFAULT 0 CHECK (nesting_depth BETWEEN 0 AND 8),
  ADD CONSTRAINT workforce_run_admission_nesting CHECK ((parent_admission_id IS NULL) = (nesting_depth = 0)),
  ADD CONSTRAINT workforce_run_admission_not_own_parent CHECK (parent_admission_id IS DISTINCT FROM id);
CREATE INDEX workforce_run_admissions_parent ON workforce_run_admissions(parent_admission_id) WHERE parent_admission_id IS NOT NULL;
COMMENT ON COLUMN workforce_run_admissions.parent_admission_id IS
  'RUN-10: the admission this run is a sub-reservation of. Its ceiling is carved from the parent envelope, never copied.';

-- The first revoked admission on the chain from this one up to its root, nearest first; NULL when the
-- whole chain is live. One definition, used by the lease guard, the envelope guard and the capacity views,
-- so "is this run fenced" can never have two answers.
CREATE FUNCTION workforce_run_admission_fence(admission UUID) RETURNS UUID LANGUAGE sql STABLE AS $$
  WITH RECURSIVE chain(id, parent_id, hop) AS (
    SELECT a.id, a.parent_admission_id, 0 FROM workforce_run_admissions a WHERE a.id = admission
    UNION ALL
    SELECT a.id, a.parent_admission_id, c.hop + 1 FROM workforce_run_admissions a JOIN chain c ON a.id = c.parent_id
     WHERE c.hop < 16)
  SELECT c.id FROM chain c JOIN workforce_run_revocations r ON r.admission_id = c.id ORDER BY c.hop LIMIT 1
$$;

CREATE FUNCTION workforce_run_envelope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p workforce_run_admissions%ROWTYPE; carved NUMERIC;
BEGIN
  IF NEW.parent_admission_id IS NULL THEN RETURN NEW; END IF;
  -- Lock the parent: every child of one parent is decided one at a time, so the sum read below is
  -- the sum the insert commits against. The row is immutable; the lock writes nothing. NO KEY UPDATE, not
  -- UPDATE: it serializes siblings without blocking the parent's own leases and revocations, whose
  -- foreign-key checks take KEY SHARE on this row.
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
  -- Every child ever carved from this parent, revoked or not (see "counted" above).
  SELECT coalesce(sum(budget_ceiling_micro), 0) INTO carved FROM workforce_run_admissions WHERE parent_admission_id = p.id;
  IF carved + NEW.budget_ceiling_micro > p.budget_ceiling_micro THEN
    RAISE EXCEPTION 'a child sub-reservation exceeds the remaining parent envelope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workforce_run_admissions_envelope_guard BEFORE INSERT ON workforce_run_admissions
  FOR EACH ROW EXECUTE FUNCTION workforce_run_envelope_guard();

-- The lease guard now refuses a lease under a fenced chain, not only under the admission's own
-- revocation: a stale worker whose PARENT was stopped cannot reconnect and be re-leased.
CREATE OR REPLACE FUNCTION workforce_run_lease_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest BIGINT;
BEGIN
  IF workforce_run_admission_fence(NEW.admission_id) IS NOT NULL THEN
    RAISE EXCEPTION 'a revoked admission authorizes nothing further' USING ERRCODE = '23514';
  END IF;
  SELECT max(sequence) INTO latest FROM workforce_run_leases WHERE admission_id = NEW.admission_id;
  IF NEW.sequence <> coalesce(latest, 0) + 1 THEN
    RAISE EXCEPTION 'a lease sequence advances by exactly one' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- LIFE-09's views, redefined so a fenced chain is not active and a child is not a second commitment.
-- Same columns in the same order (CREATE OR REPLACE), one appended.
CREATE OR REPLACE VIEW workforce_admission_activity AS
SELECT a.id AS admission_id,
  a.target_kind, a.target_owner_user_id, a.target_workspace_id, a.project_id,
  a.agent_resource_id, a.payer_user_id, a.budget_ceiling_micro,
  (workforce_run_admission_fence(a.id) IS NULL) AS active,
  (workforce_run_admission_fence(a.id) IS NULL AND EXISTS (SELECT 1 FROM workforce_run_leases l
     WHERE l.admission_id = a.id AND l.expires_at > clock_timestamp())) AS in_flight,
  a.admitted_at,
  a.parent_admission_id
FROM workforce_run_admissions a;

CREATE OR REPLACE VIEW workforce_scope_capacity AS
SELECT
  CASE WHEN target_workspace_id IS NOT NULL THEN 'workspace' ELSE 'user' END AS scope_type,
  COALESCE(target_workspace_id, target_owner_user_id) AS scope_id,
  count(*) FILTER (WHERE active)::bigint AS active_admissions,
  count(*) FILTER (WHERE in_flight)::bigint AS in_flight_runs,
  count(DISTINCT agent_resource_id) FILTER (WHERE active)::bigint AS active_agents,
  COALESCE(sum(budget_ceiling_micro) FILTER (WHERE active AND parent_admission_id IS NULL), 0)::numeric AS committed_ceiling_micro,
  COALESCE(array_agg(DISTINCT payer_user_id) FILTER (WHERE active), '{}')::uuid[] AS active_payers
FROM workforce_admission_activity
GROUP BY 1, 2;

DO $harden$
BEGIN
  EXECUTE format('ALTER FUNCTION %I.workforce_run_admission_fence(uuid) SET search_path = %I, pg_temp', current_schema(), current_schema());
  EXECUTE format('ALTER FUNCTION %I.workforce_run_envelope_guard() SET search_path = %I, pg_temp', current_schema(), current_schema());
  EXECUTE format('ALTER FUNCTION %I.workforce_run_lease_guard() SET search_path = %I, pg_temp', current_schema(), current_schema());
END $harden$;

-- DOWN
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM workforce_run_admissions WHERE parent_admission_id IS NOT NULL) THEN
    RAISE EXCEPTION 'nested run rollback refused: child admissions exist' USING ERRCODE = '23514';
  END IF;
END $$;
DROP VIEW workforce_scope_capacity;
DROP VIEW workforce_admission_activity;
CREATE VIEW workforce_admission_activity AS
SELECT a.id AS admission_id,
  a.target_kind, a.target_owner_user_id, a.target_workspace_id, a.project_id,
  a.agent_resource_id, a.payer_user_id, a.budget_ceiling_micro,
  (r.admission_id IS NULL) AS active,
  (r.admission_id IS NULL AND EXISTS (SELECT 1 FROM workforce_run_leases l
     WHERE l.admission_id = a.id AND l.expires_at > clock_timestamp())) AS in_flight,
  a.admitted_at
FROM workforce_run_admissions a
LEFT JOIN workforce_run_revocations r ON r.admission_id = a.id;
CREATE VIEW workforce_scope_capacity AS
SELECT
  CASE WHEN target_workspace_id IS NOT NULL THEN 'workspace' ELSE 'user' END AS scope_type,
  COALESCE(target_workspace_id, target_owner_user_id) AS scope_id,
  count(*) FILTER (WHERE active)::bigint AS active_admissions,
  count(*) FILTER (WHERE in_flight)::bigint AS in_flight_runs,
  count(DISTINCT agent_resource_id) FILTER (WHERE active)::bigint AS active_agents,
  COALESCE(sum(budget_ceiling_micro) FILTER (WHERE active), 0)::numeric AS committed_ceiling_micro,
  COALESCE(array_agg(DISTINCT payer_user_id) FILTER (WHERE active), '{}')::uuid[] AS active_payers
FROM workforce_admission_activity
GROUP BY 1, 2;
CREATE OR REPLACE FUNCTION workforce_run_lease_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM workforce_run_revocations WHERE admission_id = NEW.admission_id) THEN
    RAISE EXCEPTION 'a revoked admission authorizes nothing further' USING ERRCODE = '23514';
  END IF;
  SELECT max(sequence) INTO latest FROM workforce_run_leases WHERE admission_id = NEW.admission_id;
  IF NEW.sequence <> coalesce(latest, 0) + 1 THEN
    RAISE EXCEPTION 'a lease sequence advances by exactly one' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DO $harden$
BEGIN
  EXECUTE format('ALTER FUNCTION %I.workforce_run_lease_guard() SET search_path = %I, pg_temp', current_schema(), current_schema());
END $harden$;
DROP TRIGGER workforce_run_admissions_envelope_guard ON workforce_run_admissions;
DROP FUNCTION workforce_run_envelope_guard();
DROP FUNCTION workforce_run_admission_fence(uuid);
DROP INDEX workforce_run_admissions_parent;
ALTER TABLE workforce_run_admissions DROP CONSTRAINT workforce_run_admission_not_own_parent,
  DROP CONSTRAINT workforce_run_admission_nesting, DROP COLUMN nesting_depth, DROP COLUMN parent_admission_id;
