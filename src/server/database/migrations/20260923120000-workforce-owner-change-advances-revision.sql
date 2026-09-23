-- UP
-- A workforce resource's OWNER could be moved without advancing its revision. Measured
-- 2026-09-23 against real PostgreSQL, on the chain as it stood:
--   UPDATE workforce_resources SET owner_user_id = <someone else> WHERE id = <resource>
-- succeeded and left `revision` at 1.
--
-- 🔴 WHY THAT IS A DEFECT AND NOT MERELY UNTIDY. `revision` is what every snapshot check in this
-- chain compares against. `workforce_workspace_assignment_acceptance` re-reads the resource and
-- refuses when `resource.revision <> NEW.resource_revision` OR the owner no longer matches the
-- source owner the assignment was approved under. That second test only catches a drift it can
-- SEE: an owner moved without a revision bump produces a resource that is materially different
-- while every version-based consumer still believes its snapshot is current. The assignment
-- suite's own concurrency case writes `owner_workspace_id=$2, revision=revision+1` -- it has
-- always assumed the bump. Nothing required it.
--
-- So: an owner change must advance the revision. Not immutability -- OWN-01 says a resource has
-- one canonical owner "permanent until an explicit, audited transfer", so transfer is meant to
-- exist, and freezing the columns would make the acceptance check's owner comparison permanently
-- dead code and forbid the very operation the spec anticipates. This makes the change VISIBLE to
-- everything already watching, and leaves building transfer -- source authorization, destination
-- acceptance, dependency/licence review, an auditable operation -- as the product work it is.
--
-- `IS DISTINCT FROM` so NULL -> value and value -> NULL both count; personal -> company in a
-- single statement is the form a "move this to my company" feature writes first, and it satisfies
-- the owner XOR while changing both columns at once.
CREATE FUNCTION workforce_resource_owner_change_advances_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
      OR NEW.owner_workspace_id IS DISTINCT FROM OLD.owner_workspace_id)
     AND NEW.revision <= OLD.revision THEN
    RAISE EXCEPTION 'workforce resource ownership changed without advancing revision; a transfer every snapshot check is blind to is not a transfer'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER workforce_resources_owner_change_advances_revision
  BEFORE UPDATE OF owner_user_id, owner_workspace_id ON workforce_resources
  FOR EACH ROW EXECUTE FUNCTION workforce_resource_owner_change_advances_revision();

-- DOWN
DROP TRIGGER workforce_resources_owner_change_advances_revision ON workforce_resources;
DROP FUNCTION workforce_resource_owner_change_advances_revision();
