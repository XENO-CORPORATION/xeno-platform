-- UP
-- XENO-WORKFORCE-01 LIFE-05 -- a change of team function is a DECIDED act, with its actor and reason.
--
--   "Promotion and demotion change a FUNCTION, never authority directly. Changing a team function
--    (8.2a ROLE-02) or a division head (DIV-06) is a membership revision with a recorded actor and
--    reason. ROLE-05 still holds: the effective right is the intersection, so a promotion grants
--    nothing the principal's owner does not already hold."
--
-- Measured before building: the membership row records who CREATED it and a revision, never who
-- changed its role or why. workforce_operations can hold a `member.promote` decision with a
-- decider, an authority and a rationale -- but nothing REQUIRED one, so a role changed with a plain
-- UPDATE and left no trace of who or why. That is a log somebody may or may not keep, which is not
-- what the requirement says.
--
-- So a role change now carries the decision it was taken under, by reference, and the database
-- refuses the change without one:
--
--   role_decision_*   the (actor, client, operation) of the workforce_operations row that decided
--                     the CURRENT role -- a composite FK, so a membership cannot point at a decision
--                     that does not exist. NULL only while the role is the one the member joined with.
--   the guard         on any role change, the referenced decision must be a `member.promote` whose
--                     subject IS this membership, and must be newly referenced -- reusing an earlier
--                     decision for a second change is a change nobody decided. The decision record is
--                     immutable and carries LIFE-07's two principals, so "who and why" cannot be
--                     edited afterwards.
--
-- ROLE-05's half is untouched and is still asserted by the promotion census: the decision is a
-- RECORD, not a grant. It writes no tuple and admits nothing; it names who changed a function.
--
-- A DIVISION HEAD change (DIV-06) is the same act on workforce_divisions.head_principal_id and gets
-- the same rule: it must reference a `member.promote` decision whose subject is that division. Not
-- `division.assign` -- appointing a head assigns no resource, it changes who holds a function, which
-- is the act LIFE-05 names. Recording both under one kind means one query answers "who changed a
-- function, and why", whether the function was a team role or a division head.
--
-- The one exception is account erasure: a head the FK nulled because the user was deleted was not
-- decided by anyone, and requiring a decision there would make erasing that account impossible.

ALTER TABLE workforce_team_memberships
  ADD COLUMN role_decision_actor_user_id UUID,
  ADD COLUMN role_decision_client_id VARCHAR(128),
  ADD COLUMN role_decision_operation_id UUID,
  ADD CONSTRAINT workforce_membership_role_decision_fields
    CHECK (num_nonnulls(role_decision_actor_user_id, role_decision_client_id, role_decision_operation_id) IN (0, 3)),
  ADD CONSTRAINT workforce_membership_role_decision
    FOREIGN KEY (role_decision_actor_user_id, role_decision_client_id, role_decision_operation_id)
    REFERENCES workforce_operations(actor_user_id, client_id, operation_id) ON DELETE RESTRICT;

ALTER TABLE workforce_divisions
  ADD COLUMN head_decision_actor_user_id UUID,
  ADD COLUMN head_decision_client_id VARCHAR(128),
  ADD COLUMN head_decision_operation_id UUID,
  ADD CONSTRAINT workforce_division_head_decision_fields
    CHECK (num_nonnulls(head_decision_actor_user_id, head_decision_client_id, head_decision_operation_id) IN (0, 3)),
  ADD CONSTRAINT workforce_division_head_decision
    FOREIGN KEY (head_decision_actor_user_id, head_decision_client_id, head_decision_operation_id)
    REFERENCES workforce_operations(actor_user_id, client_id, operation_id) ON DELETE RESTRICT;

CREATE FUNCTION workforce_function_change_decided() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE op workforce_operations%ROWTYPE; changed BOOLEAN; subject UUID;
        new_actor UUID; new_client TEXT; new_op UUID; old_op UUID;
BEGIN
  IF TG_TABLE_NAME = 'workforce_team_memberships' THEN
    changed := NEW.role IS DISTINCT FROM OLD.role;
    subject := NEW.id;
    new_actor := NEW.role_decision_actor_user_id; new_client := NEW.role_decision_client_id;
    new_op := NEW.role_decision_operation_id; old_op := OLD.role_decision_operation_id;
  ELSE
    changed := NEW.head_principal_id IS DISTINCT FROM OLD.head_principal_id
      -- A head cleared because the account was erased is not a decision; the FK did it.
      AND NOT (NEW.head_principal_id IS NULL AND OLD.head_principal_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.head_principal_id));
    subject := NEW.id;
    new_actor := NEW.head_decision_actor_user_id; new_client := NEW.head_decision_client_id;
    new_op := NEW.head_decision_operation_id; old_op := OLD.head_decision_operation_id;
  END IF;

  IF NOT changed THEN
    -- The decision reference is part of the record of the current function; it moves only with it.
    IF new_op IS DISTINCT FROM old_op THEN
      RAISE EXCEPTION 'a function decision is recorded only with the change it decided' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  IF new_op IS NULL OR new_op IS NOT DISTINCT FROM old_op THEN
    RAISE EXCEPTION 'changing a function requires the decision that changed it -- who decided, and why' USING ERRCODE='23514';
  END IF;
  SELECT * INTO op FROM workforce_operations
   WHERE actor_user_id = new_actor AND client_id = new_client AND operation_id = new_op;
  -- NULL-safe throughout: a reference to no decision at all is refused here, not only by the FK.
  IF op.kind IS DISTINCT FROM 'member.promote' OR op.subject_id IS DISTINCT FROM subject
     OR op.subject_type IS DISTINCT FROM (CASE WHEN TG_TABLE_NAME = 'workforce_team_memberships' THEN 'membership' ELSE 'division' END) THEN
    RAISE EXCEPTION 'a function change is decided by a member.promote record about this very membership or division' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER workforce_team_memberships_function_decided
BEFORE UPDATE ON workforce_team_memberships
FOR EACH ROW EXECUTE FUNCTION workforce_function_change_decided();
CREATE TRIGGER workforce_divisions_head_decided
BEFORE UPDATE ON workforce_divisions
FOR EACH ROW EXECUTE FUNCTION workforce_function_change_decided();

-- The record LIFE-05 asks for, read in one place: every function change, with its actor and reason.
CREATE VIEW workforce_function_changes AS
SELECT 'membership'::text AS scope, m.id AS subject_id, m.role AS function_now,
       o.deciding_principal_id, o.responsible_account_id, o.authority, o.rationale, o.committed_at
  FROM workforce_team_memberships m
  JOIN workforce_operations o ON (o.actor_user_id, o.client_id, o.operation_id)
                               = (m.role_decision_actor_user_id, m.role_decision_client_id, m.role_decision_operation_id)
UNION ALL
SELECT 'division', d.id, d.head_principal_id::text,
       o.deciding_principal_id, o.responsible_account_id, o.authority, o.rationale, o.committed_at
  FROM workforce_divisions d
  JOIN workforce_operations o ON (o.actor_user_id, o.client_id, o.operation_id)
                               = (d.head_decision_actor_user_id, d.head_decision_client_id, d.head_decision_operation_id);

DO $harden$
BEGIN
  EXECUTE format('ALTER FUNCTION %I.workforce_function_change_decided() SET search_path = %I, pg_temp',
    current_schema(), current_schema());
END $harden$;

-- DOWN
DROP VIEW workforce_function_changes;
DROP TRIGGER workforce_divisions_head_decided ON workforce_divisions;
DROP TRIGGER workforce_team_memberships_function_decided ON workforce_team_memberships;
DROP FUNCTION workforce_function_change_decided();
ALTER TABLE workforce_divisions
  DROP CONSTRAINT workforce_division_head_decision,
  DROP CONSTRAINT workforce_division_head_decision_fields,
  DROP COLUMN head_decision_operation_id, DROP COLUMN head_decision_client_id, DROP COLUMN head_decision_actor_user_id;
ALTER TABLE workforce_team_memberships
  DROP CONSTRAINT workforce_membership_role_decision,
  DROP CONSTRAINT workforce_membership_role_decision_fields,
  DROP COLUMN role_decision_operation_id, DROP COLUMN role_decision_client_id, DROP COLUMN role_decision_actor_user_id;
