-- UP
-- XENO-WORKFORCE-01 DIV-05 (§8.2b) and the §12 "Workspace assignment" record, ADOPTED 2026-09-22:
-- "the target may be a DIVISION inside the target workspace, not only the workspace itself. This
-- record is the ASSIGNMENT edge (DIV-05, mirroring ASN-01); the OWNING division is a separate edge
-- ... Absent division = workspace-level, which is an explicit state."
--
-- So the division target is a COLUMN on the existing assignment record, not a new table: an
-- assignment is already separately proposed, separately accepted and separately revocable, and
-- DIV-05 asks for exactly those properties toward a division. A second table would be a second
-- assignment model.
--
-- What this deliberately does NOT touch: workforce_division_ownership and workforce_division_funding.
-- Assigning a team to a division moves neither (DIV-05, ASN-01, DIV-07) -- they are different rows
-- in different tables, and nothing here writes to them.

ALTER TABLE workforce_workspace_assignments ADD COLUMN target_division_id UUID;

-- The division must be INSIDE the assignment's target workspace. Carried as a composite foreign key
-- onto workforce_divisions(id, workspace_id), the same device the division parent edge uses, so a
-- division of another workspace is unrepresentable rather than merely checked. MATCH SIMPLE: when
-- target_division_id is NULL the row is workspace-level and the key is not checked -- that NULL is
-- the explicit "workspace-level" state §12 names, never an encoding of "every division".
ALTER TABLE workforce_workspace_assignments
  ADD CONSTRAINT workforce_assignment_division_in_target_workspace
  FOREIGN KEY (target_division_id, workspace_id) REFERENCES workforce_divisions(id, workspace_id) ON DELETE RESTRICT;

-- One live assignment per (resource, workspace) was the rule; with a division target it becomes one
-- live assignment per (resource, workspace, division) -- the shared platform team DIV-05 describes
-- serves several divisions of one workspace, each through its own record. The workspace-level
-- assignment keeps its own slot: COALESCE maps it onto the nil UUID, which no division can have.
DROP INDEX workforce_workspace_assignments_live_pair;
CREATE UNIQUE INDEX workforce_workspace_assignments_live_pair
  ON workforce_workspace_assignments(resource_id, workspace_id,
    COALESCE(target_division_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE state IN ('proposed','accepted');

CREATE INDEX workforce_workspace_assignments_division_catalog
  ON workforce_workspace_assignments(target_division_id, state, created_at DESC, id DESC)
  WHERE target_division_id IS NOT NULL;

-- The column is part of the assignment's IDENTITY, like workspace_id: retargeting to another division
-- would be a different assignment wearing an old record's acceptance. And an archived division admits
-- nothing new (OWN-06, the same rule workforce_division_edge_guard applies to ownership and funding),
-- while assignments already made to it are left alone -- archive is not a cascade.
CREATE FUNCTION workforce_assignment_division_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE div_state TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.target_division_id IS DISTINCT FROM OLD.target_division_id THEN
    RAISE EXCEPTION 'workforce assignment division target is immutable; revoke and repropose' USING ERRCODE='23514';
  END IF;
  IF NEW.target_division_id IS NOT NULL AND (TG_OP = 'INSERT'
      OR (NEW.state = 'accepted' AND OLD.state IS DISTINCT FROM 'accepted')) THEN
    SELECT lifecycle INTO div_state FROM workforce_divisions WHERE id = NEW.target_division_id FOR SHARE;
    IF div_state IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'an archived division admits no new assignments' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER workforce_workspace_assignments_division_guard
BEFORE INSERT OR UPDATE ON workforce_workspace_assignments
FOR EACH ROW EXECUTE FUNCTION workforce_assignment_division_guard();

-- DOWN
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM workforce_workspace_assignments WHERE target_division_id IS NOT NULL) THEN
    RAISE EXCEPTION 'division-target rollback refused: division assignments exist' USING ERRCODE='23514';
  END IF;
END $$;
DROP TRIGGER workforce_workspace_assignments_division_guard ON workforce_workspace_assignments;
DROP FUNCTION workforce_assignment_division_guard();
DROP INDEX workforce_workspace_assignments_division_catalog;
DROP INDEX workforce_workspace_assignments_live_pair;
CREATE UNIQUE INDEX workforce_workspace_assignments_live_pair
  ON workforce_workspace_assignments(resource_id,workspace_id) WHERE state IN ('proposed','accepted');
ALTER TABLE workforce_workspace_assignments DROP CONSTRAINT workforce_assignment_division_in_target_workspace;
ALTER TABLE workforce_workspace_assignments DROP COLUMN target_division_id;
