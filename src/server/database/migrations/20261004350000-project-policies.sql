-- UP
-- PUB-01: ownership, visibility, contribution policy and execution
-- permissions are independent fields. Ownership lives on chat_projects,
-- visibility on project_publications; this adds the two policy columns
-- beside visibility so each changes without touching the others.
-- Defaults are closed: maintainers-only contributions, no execution.
ALTER TABLE project_publications
  ADD COLUMN IF NOT EXISTS contribution_policy TEXT NOT NULL DEFAULT 'maintainers-only'
    CHECK (contribution_policy IN ('offers-open', 'maintainers-only', 'closed')),
  ADD COLUMN IF NOT EXISTS execution_policy TEXT NOT NULL DEFAULT 'none'
    CHECK (execution_policy IN ('sandbox-only', 'maintainer-runners', 'none'));
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM project_publications
    WHERE contribution_policy <> 'maintainers-only' OR execution_policy <> 'none') THEN
    RAISE EXCEPTION 'policy rollback refused: non-default policies exist' USING ERRCODE='23514';
  END IF;
  ALTER TABLE project_publications DROP COLUMN contribution_policy;
  ALTER TABLE project_publications DROP COLUMN execution_policy;
END $$;
