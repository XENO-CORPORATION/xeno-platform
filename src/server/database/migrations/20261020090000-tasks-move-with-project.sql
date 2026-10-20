-- UP
-- D-5 (XENO-WORKFORCE-01 §8.11.1, DECIDED 2026-10-20): a task never transfers ALONE. It lives where its project lives
-- (or, without a project, with its personal owner), and it moves only when its PROJECT moves (OWN-05): the project row
-- changes scope and every task on it follows by reference, with no task row rewritten. So a task's project_id and
-- owner_user_id never change to another value after creation. The one change allowed is to NULL, which is the
-- foreign keys' own ON DELETE SET NULL (a deleted project or account), not a transfer.
-- Additive: no column changes, no rows rewritten; DOWN removes the guard exactly.
CREATE OR REPLACE FUNCTION tasks_move_with_project_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.project_id IS DISTINCT FROM OLD.project_id AND NEW.project_id IS NOT NULL THEN
    RAISE EXCEPTION 'a task moves only with its project (D-5)' USING ERRCODE = '23514';
  END IF;
  IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id AND NEW.owner_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'a task is never transferred alone (D-5)' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tasks_move_with_project_guard ON tasks;
CREATE TRIGGER tasks_move_with_project_guard BEFORE UPDATE OF project_id, owner_user_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION tasks_move_with_project_guard();

-- DOWN
DROP TRIGGER IF EXISTS tasks_move_with_project_guard ON tasks;
DROP FUNCTION IF EXISTS tasks_move_with_project_guard();
