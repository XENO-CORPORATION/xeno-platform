-- UP
-- XENO-WORKFORCE-01 VIEW-03 -- create a resource and assign it, as ONE durable command.
--
--   VIEW-03: "Global creation requires explicit/default-displayed owner and optional assignments.
--            Workspace creation displays owner and performs create-plus-assign as one durable command.
--            Failure retains the draft and does not create duplicates on retry."
--
-- Creation already had a durable receipt (workforce_resource_operations): one per (actor, client,
-- operation), so a retried create returns the resource it made instead of making another. What it did
-- not have was a way to ASSIGN in the same command -- a client wanting "create this agent in my
-- workspace" had to create it, then assign it, and a failure between the two left an owned resource
-- that was in no workspace, with nothing recording that the second half had ever been asked for.
--
-- This adds the missing half of the receipt: the assignments one creation made, recorded against that
-- creation's receipt, in the same transaction. A retry of the same command therefore returns the same
-- resource AND the same assignments, and writes nothing; a failure anywhere writes nothing at all,
-- because the resource, its receipt, its assignments and this record commit or roll back together.
--
-- The assignment rows themselves are ordinary workforce_workspace_assignments, under every rule that
-- table already enforces (ASN-04's two recorded checks, ASN-05's member set, the live-pair uniqueness).
-- This file records only WHICH assignments a creation made; it grants nothing and decides nothing.

CREATE TABLE workforce_resource_operation_assignments (
  actor_user_id UUID NOT NULL,
  client_id VARCHAR(128) NOT NULL,
  operation_id UUID NOT NULL,
  -- The order the command listed its targets in, so a replay returns them in the same order.
  position SMALLINT NOT NULL CHECK (position BETWEEN 0 AND 31),
  assignment_id UUID NOT NULL UNIQUE REFERENCES workforce_workspace_assignments(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL,
  PRIMARY KEY (actor_user_id, client_id, operation_id, position),
  UNIQUE (actor_user_id, client_id, operation_id, workspace_id),
  FOREIGN KEY (actor_user_id, client_id, operation_id)
    REFERENCES workforce_resource_operations(actor_user_id, client_id, operation_id) ON DELETE RESTRICT
);
COMMENT ON TABLE workforce_resource_operation_assignments IS
  'VIEW-03: the assignments one create-plus-assign command made, bound to its creation receipt. Immutable.';

CREATE FUNCTION workforce_resource_operation_assignment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt workforce_resource_operations%ROWTYPE; a workforce_workspace_assignments%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'a creation''s assignment record is immutable and retained' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO receipt FROM workforce_resource_operations
   WHERE actor_user_id = NEW.actor_user_id AND client_id = NEW.client_id AND operation_id = NEW.operation_id;
  SELECT * INTO a FROM workforce_workspace_assignments WHERE id = NEW.assignment_id;
  -- The assignment is of the resource that creation made, into the workspace this row names. Anything
  -- else would let a receipt claim an assignment some other act made.
  IF NOT FOUND OR a.resource_id IS DISTINCT FROM receipt.resource_id OR a.workspace_id IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION 'a creation records only assignments of the resource it created' USING ERRCODE = '23514';
  END IF;
  -- Made by the same actor in the same transaction as the creation it belongs to: never attached later.
  IF a.created_by_user_id IS DISTINCT FROM NEW.actor_user_id OR a.created_at IS DISTINCT FROM receipt.committed_at THEN
    RAISE EXCEPTION 'a creation records only the assignments it made itself, when it made them' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workforce_resource_operation_assignments_guard BEFORE INSERT OR UPDATE OR DELETE
  ON workforce_resource_operation_assignments FOR EACH ROW EXECUTE FUNCTION workforce_resource_operation_assignment_guard();
CREATE TRIGGER workforce_resource_operation_assignments_no_truncate BEFORE TRUNCATE
  ON workforce_resource_operation_assignments FOR EACH STATEMENT EXECUTE FUNCTION workforce_resource_operation_assignment_guard();

DO $harden$
BEGIN
  EXECUTE format('ALTER FUNCTION %I.workforce_resource_operation_assignment_guard() SET search_path = %I, pg_temp', current_schema(), current_schema());
END $harden$;

-- DOWN
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM workforce_resource_operation_assignments) THEN
    RAISE EXCEPTION 'create-and-assign rollback refused: retained creation records exist' USING ERRCODE = '23514';
  END IF;
END $$;
DROP TRIGGER workforce_resource_operation_assignments_no_truncate ON workforce_resource_operation_assignments;
DROP TRIGGER workforce_resource_operation_assignments_guard ON workforce_resource_operation_assignments;
DROP TABLE workforce_resource_operation_assignments;
DROP FUNCTION workforce_resource_operation_assignment_guard();
