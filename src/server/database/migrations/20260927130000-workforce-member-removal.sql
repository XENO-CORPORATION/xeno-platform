-- UP
-- XENO-WORKFORCE-01 LIFE-02 -- removal is REVOCATION plus SETTLEMENT, and the two are separate.
--
--   LIFE-02: "Revoking eligibility is immediate (ASN-05 'removals revoke eligibility promptly');
--            settling what the principal was doing is not. In-flight runs reach a durable resumable
--            state (RUN-07), reservations settle or release (RUN-10), and only then is the membership
--            archived. A removal that silently cancels funded work, or silently lets it continue, are
--            both defects."
--
-- Before this file a membership was removed by a plain UPDATE to 'revoked'. That revoked eligibility --
-- the next step of any run under it is refused -- but a run between steps went on READING as running, its
-- committed ceiling stayed committed, and it was fenced only if and when it asked again. Nothing recorded
-- who removed the member or why, and nothing said when the member's work was settled.
--
-- A REMOVAL is now one record, written in the same transaction as the revocation, beside a
-- `member.remove` decision (LIFE-06) that names who decided:
--
--   revocation   IMMEDIATE, and a property of the MEMBERSHIP ROW, not of one writer. The moment a seat goes
--                active -> revoked -- through the removal service, the workspace teams page, or any SQL at
--                all -- every run that seat was doing is fenced durably in the same statement
--                (`authority_lost`, RUN-03): the runs it admitted as a member, the runs of the agent it
--                held, and their descendants. Not on the run's next step. The run is not deleted and
--                nothing about it is rewritten: it reads as INTERRUPTED (RUN-04) with its task, results
--                and lease history intact -- the durable, resumable state RUN-07 names.
--   settlement   DERIVED, never declared. A removed member's run is settled when it is fenced, holds no
--                live lease (a disconnected worker may still be inside one, NFR-06), and is ACCOUNTED FOR:
--                its runtime reported what happened (RUN-04), or -- for a child -- its outcome was
--                delivered to its parent. `workforce_membership_removal_runs` is that projection, and it
--                is the ONE place the rule lives: the service reads it, and so does the guard below.
--   archival     a separate, later act, and the database refuses it while any of those runs is unsettled.
--
-- So neither defect is possible: the work is not cancelled silently (it is fenced by name, recorded, and
-- readable as interrupted), and it does not continue silently (it can authorize nothing further, it stays
-- visible as unsettled until it is accounted for, and the admission guard below refuses a NEW run under
-- a seat that is being revoked).

CREATE TABLE workforce_membership_removals (
  membership_id UUID PRIMARY KEY REFERENCES workforce_team_memberships(id) ON DELETE RESTRICT,
  team_id UUID NOT NULL,
  decision_actor_user_id UUID NOT NULL,
  decision_client_id VARCHAR(128) NOT NULL,
  decision_operation_id UUID NOT NULL,
  -- The instant the removal is effective, and the boundary of the runs it fences. Set from the
  -- transaction clock by the writer, so the fence and the record name the same moment.
  removed_at TIMESTAMPTZ NOT NULL,
  archived_at TIMESTAMPTZ,
  archived_by_user_id UUID,
  FOREIGN KEY (decision_actor_user_id, decision_client_id, decision_operation_id)
    REFERENCES workforce_operations(actor_user_id, client_id, operation_id) ON DELETE RESTRICT,
  CONSTRAINT workforce_membership_removal_archival CHECK (archived_at IS NULL OR archived_at >= removed_at)
);
CREATE INDEX workforce_membership_removals_team ON workforce_membership_removals(team_id, removed_at);
COMMENT ON TABLE workforce_membership_removals IS
  'LIFE-02: a membership removal -- immediate revocation, with the runs it fenced settling separately. Archival waits for settlement.';

-- The runs a removal fenced, and whether each is settled. Takes the boundary explicitly rather than
-- reading it from the row, so the BEFORE INSERT guard can ask the same question about the row it is
-- inserting -- one rule, two callers, never two answers.
CREATE FUNCTION workforce_membership_removal_runs(p_membership UUID, p_removed_at TIMESTAMPTZ)
RETURNS TABLE(admission_id UUID, fenced BOOLEAN, lease_live BOOLEAN, accounted BOOLEAN) LANGUAGE sql AS $$
  WITH RECURSIVE seat AS (
    SELECT m.team_id, m.member_resource_id FROM workforce_team_memberships m WHERE m.id = p_membership
  ), direct AS (
    SELECT a.id AS admission_id
      FROM workforce_run_admissions a, seat
     WHERE a.team_id = seat.team_id AND a.admitted_at <= p_removed_at
       AND (a.team_membership_id = p_membership
         OR (seat.member_resource_id IS NOT NULL AND a.agent_resource_id = seat.member_resource_id))
  ), tree(admission_id) AS (
    SELECT admission_id FROM direct
    UNION
    SELECT c.id FROM tree t JOIN workforce_run_admissions c ON c.parent_admission_id = t.admission_id
  )
  SELECT t.admission_id,
    (workforce_run_admission_fence(t.admission_id) IS NOT NULL) AS fenced,
    EXISTS (SELECT 1 FROM workforce_run_leases l WHERE l.admission_id = t.admission_id AND l.expires_at > clock_timestamp()) AS lease_live,
    (EXISTS (SELECT 1 FROM workforce_run_results x WHERE x.admission_id = t.admission_id)
      OR EXISTS (SELECT 1 FROM workforce_run_result_deliveries d WHERE d.child_admission_id = t.admission_id)) AS accounted
  FROM tree t ORDER BY t.admission_id;
$$;

CREATE FUNCTION workforce_membership_removal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m workforce_team_memberships%ROWTYPE; op workforce_operations%ROWTYPE;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'a membership removal is retained' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO m FROM workforce_team_memberships WHERE id = NEW.membership_id FOR SHARE;
    IF NOT FOUND OR m.state <> 'revoked' OR m.team_id IS DISTINCT FROM NEW.team_id THEN
      RAISE EXCEPTION 'a removal records a membership already revoked, in the same act' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO op FROM workforce_operations WHERE actor_user_id = NEW.decision_actor_user_id
      AND client_id = NEW.decision_client_id AND operation_id = NEW.decision_operation_id;
    IF op.kind IS DISTINCT FROM 'member.remove' OR op.subject_type IS DISTINCT FROM 'membership' OR op.subject_id IS DISTINCT FROM NEW.membership_id THEN
      RAISE EXCEPTION 'a removal is decided by a member.remove record about this very membership' USING ERRCODE = '23514';
    END IF;
    IF NEW.archived_at IS NOT NULL OR NEW.archived_by_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'a removal is archived later, never at the moment of removal' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: archival only, once.
  IF ROW(NEW.membership_id, NEW.team_id, NEW.decision_actor_user_id, NEW.decision_client_id, NEW.decision_operation_id, NEW.removed_at)
     IS DISTINCT FROM ROW(OLD.membership_id, OLD.team_id, OLD.decision_actor_user_id, OLD.decision_client_id, OLD.decision_operation_id, OLD.removed_at)
     OR OLD.archived_at IS NOT NULL OR NEW.archived_at IS NULL THEN
    RAISE EXCEPTION 'a removal changes only once, when it is archived' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM workforce_membership_removal_runs(NEW.membership_id, NEW.removed_at)
               WHERE NOT (fenced AND NOT lease_live AND accounted)) THEN
    RAISE EXCEPTION 'a removal is archived only once every run it fenced is settled' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workforce_membership_removals_guard BEFORE INSERT OR UPDATE OR DELETE ON workforce_membership_removals
  FOR EACH ROW EXECUTE FUNCTION workforce_membership_removal_guard();
CREATE TRIGGER workforce_membership_removals_no_truncate BEFORE TRUNCATE ON workforce_membership_removals
  FOR EACH STATEMENT EXECUTE FUNCTION workforce_membership_removal_guard();

-- Revoking a seat fences its work, whoever revokes it. Only the TOP of each chain the seat reaches is
-- revoked by name; everything below is fenced by that ancestor (RUN-10), so a child reads as stopped
-- because its parent was -- which is what happened. A reached run whose parent is someone else's work (a
-- removed agent's child under a manager's run) is fenced by name, and the parent is left alone.
CREATE FUNCTION workforce_membership_revocation_fences() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  WITH reached AS (SELECT * FROM workforce_membership_removal_runs(NEW.id, NEW.revoked_at))
  INSERT INTO workforce_run_revocations(admission_id, reason)
  SELECT r.admission_id, 'authority_lost' FROM reached r JOIN workforce_run_admissions a ON a.id = r.admission_id
   WHERE NOT r.fenced AND (a.parent_admission_id IS NULL OR a.parent_admission_id NOT IN (SELECT admission_id FROM reached))
  ON CONFLICT (admission_id) DO NOTHING;
  RETURN NULL;
END $$;
CREATE TRIGGER workforce_team_memberships_revocation_fences AFTER UPDATE OF state ON workforce_team_memberships
  FOR EACH ROW WHEN (OLD.state = 'active' AND NEW.state = 'revoked')
  EXECUTE FUNCTION workforce_membership_revocation_fences();

-- LIFE-02's "does not continue silently" half, as a fact about the admission rather than a check in one
-- service. A run is admitted under a seat that is LIVE, and the seat row is held FOR SHARE until the
-- admitting transaction ends -- so a removal revoking that seat from another connection and this
-- admission cannot both win: either the removal waits and refuses the admission, or the admission commits
-- first and the removal fences it. Without the lock there is a window in which a run is admitted under a
-- seat removed a millisecond earlier, and it would read as running until it next asked.
CREATE FUNCTION workforce_run_membership_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE seat workforce_team_memberships%ROWTYPE;
BEGIN
  IF NEW.team_membership_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO seat FROM workforce_team_memberships WHERE id = NEW.team_membership_id FOR SHARE;
  IF NOT FOUND OR seat.state <> 'active' THEN
    RAISE EXCEPTION 'a run is admitted only under a live membership' USING ERRCODE = '23514';
  END IF;
  IF NEW.team_id IS DISTINCT FROM seat.team_id THEN
    RAISE EXCEPTION 'a run records the seat it was admitted under' USING ERRCODE = '23514';
  END IF;
  -- The agent that runs holds a seat of its own, and removing THAT seat is the same race.
  PERFORM 1 FROM workforce_team_memberships WHERE team_id = NEW.team_id AND member_resource_id = NEW.agent_resource_id
    AND state = 'active' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'a run is admitted only for an agent that holds a live seat' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workforce_run_membership_guard BEFORE INSERT ON workforce_run_admissions
  FOR EACH ROW EXECUTE FUNCTION workforce_run_membership_guard();

DO $harden$
BEGIN
  EXECUTE format('ALTER FUNCTION %I.workforce_membership_removal_guard() SET search_path = %I, pg_temp', current_schema(), current_schema());
  EXECUTE format('ALTER FUNCTION %I.workforce_run_membership_guard() SET search_path = %I, pg_temp', current_schema(), current_schema());
  EXECUTE format('ALTER FUNCTION %I.workforce_membership_revocation_fences() SET search_path = %I, pg_temp', current_schema(), current_schema());
  EXECUTE format('ALTER FUNCTION %I.workforce_membership_removal_runs(uuid, timestamptz) SET search_path = %I, pg_temp', current_schema(), current_schema());
END $harden$;

-- DOWN
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM workforce_membership_removals) THEN
    RAISE EXCEPTION 'membership removal rollback refused: retained removals exist' USING ERRCODE = '23514';
  END IF;
END $$;
DROP TRIGGER workforce_run_membership_guard ON workforce_run_admissions;
DROP FUNCTION workforce_run_membership_guard();
DROP TRIGGER workforce_team_memberships_revocation_fences ON workforce_team_memberships;
DROP FUNCTION workforce_membership_revocation_fences();
DROP TRIGGER workforce_membership_removals_no_truncate ON workforce_membership_removals;
DROP TRIGGER workforce_membership_removals_guard ON workforce_membership_removals;
DROP FUNCTION workforce_membership_removal_guard();
DROP FUNCTION workforce_membership_removal_runs(uuid, timestamptz);
DROP TABLE workforce_membership_removals;
