-- UP
-- Losing access to a project ends a live canvas session in it. A XENO Multiplayer ticket only gates joining, so a person
-- removed from a project (or from the workspace a project inherits from, or a project moved out of its workspace) would
-- otherwise stay on its open canvas until they leave. Every way access is taken away ends in a DELETE (or an UPDATE) of
-- a relationship tuple; this says which one, and the leader re-checks that person on the project's canvases and asks the
-- service to close what they may no longer edit (workers/projectChangeWorker.js, services/canvases.js liveSeatsToEnd).
-- A NOTIFY is delivered only if its transaction commits, so the re-check reads the access that is really left.
CREATE OR REPLACE FUNCTION project_access_changed_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.object_type IN ('project', 'workspace') THEN
    PERFORM pg_notify('project_access_changed', json_build_object('o', OLD.object_type, 'oi', OLD.object_id, 'r', OLD.relation, 's', OLD.subject_type, 'si', OLD.subject_id)::text);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS reltuples_project_access_changed ON relationship_tuples;
CREATE TRIGGER reltuples_project_access_changed AFTER DELETE OR UPDATE ON relationship_tuples FOR EACH ROW EXECUTE FUNCTION project_access_changed_notify();

-- DOWN
DROP TRIGGER IF EXISTS reltuples_project_access_changed ON relationship_tuples;
DROP FUNCTION IF EXISTS project_access_changed_notify();
