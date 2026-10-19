-- UP
-- XENO-WORKFORCE-01 LIFE-08: objectives are the missing TOP of the existing work tree (RUN-06:
-- goal -> milestone -> task). An objective is a workspace- or division-level parent that goals roll up
-- to, with a stated owner, window and success evidence. It EXTENDS the coordination subsystem (ASN-08:
-- extend projects, never a second project product): one table, and one nullable edge on project_goals.
-- The database holds the shape rules the service holds:
--   - a division objective's division belongs to its workspace;
--   - a goal rolls up only to an objective of its OWN project's workspace;
--   - an objective completes only when every goal under it is completed, and never reopens.
CREATE TABLE IF NOT EXISTS project_objectives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  division_id UUID NULL REFERENCES workforce_divisions(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  success_evidence TEXT NOT NULL CHECK (char_length(btrim(success_evidence)) BETWEEN 1 AND 2000),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  window_start DATE NOT NULL,
  window_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed')),
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,
  CHECK (window_end >= window_start),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS project_objectives_workspace_idx ON project_objectives (workspace_id, created_at DESC);
ALTER TABLE project_goals ADD COLUMN IF NOT EXISTS objective_id UUID NULL REFERENCES project_objectives(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS project_goals_objective_idx ON project_goals (objective_id) WHERE objective_id IS NOT NULL;

CREATE OR REPLACE FUNCTION project_objectives_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.division_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM workforce_divisions d WHERE d.id = NEW.division_id AND d.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'an objective''s division belongs to its workspace' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.workspace_id <> OLD.workspace_id OR NEW.division_id IS DISTINCT FROM OLD.division_id THEN
      RAISE EXCEPTION 'an objective never changes its scope' USING ERRCODE = '23514';
    END IF;
    IF OLD.status = 'completed' AND NEW.status <> 'completed' THEN
      RAISE EXCEPTION 'a completed objective never reopens' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'completed' AND OLD.status = 'open' AND EXISTS (
        SELECT 1 FROM project_goals g WHERE g.objective_id = NEW.id AND g.status <> 'completed') THEN
      RAISE EXCEPTION 'an objective completes only when its goals have' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS project_objectives_guard ON project_objectives;
CREATE TRIGGER project_objectives_guard BEFORE INSERT OR UPDATE ON project_objectives
  FOR EACH ROW EXECUTE FUNCTION project_objectives_guard();

CREATE OR REPLACE FUNCTION project_goals_objective_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.objective_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM project_objectives o JOIN chat_projects p ON p.id = NEW.project_id
       WHERE o.id = NEW.objective_id AND o.workspace_id = p.workspace_id AND o.status = 'open') THEN
    RAISE EXCEPTION 'a goal rolls up only to an open objective of its own project''s workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS project_goals_objective_guard ON project_goals;
CREATE TRIGGER project_goals_objective_guard BEFORE INSERT OR UPDATE OF objective_id ON project_goals
  FOR EACH ROW EXECUTE FUNCTION project_goals_objective_guard();

-- DOWN
DROP TRIGGER IF EXISTS project_goals_objective_guard ON project_goals;
DROP FUNCTION IF EXISTS project_goals_objective_guard();
DROP INDEX IF EXISTS project_goals_objective_idx;
ALTER TABLE project_goals DROP COLUMN IF EXISTS objective_id;
DROP TRIGGER IF EXISTS project_objectives_guard ON project_objectives;
DROP FUNCTION IF EXISTS project_objectives_guard();
DROP TABLE IF EXISTS project_objectives;
