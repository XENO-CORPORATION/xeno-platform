-- UP
-- D-1 (XENO-WORKFORCE-01 §8.11.1, DECIDED 2026-10-20): the WORKSPACE is the unit of billing. A personal Pro is the
-- plan of the person's PERSONAL workspace; a team workspace carries its own plan (workspaces.metadata.billing).
--
-- EXPAND only: xeno_account_plans keeps user_id as its key, so every Stripe webhook and subscription path settles
-- exactly as before. The new workspace_id names the personal workspace the row is the plan of; it is backfilled and
-- kept filled by a trigger on every write. Readers resolve through effectivePlan.getWorkspacePlan. DOWN is exact.

ALTER TABLE xeno_account_plans ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_xeno_account_plans_workspace ON xeno_account_plans(workspace_id) WHERE workspace_id IS NOT NULL;

UPDATE xeno_account_plans p SET workspace_id = w.id
  FROM workspaces w
 WHERE p.workspace_id IS NULL AND w.workspace_type = 'personal' AND w.owner_user_id::text = p.user_id;

CREATE OR REPLACE FUNCTION xeno_account_plan_workspace_fill() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id IS NULL THEN
    SELECT w.id INTO NEW.workspace_id FROM workspaces w
     WHERE w.workspace_type = 'personal' AND w.owner_user_id::text = NEW.user_id LIMIT 1;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS xeno_account_plan_workspace_fill ON xeno_account_plans;
CREATE TRIGGER xeno_account_plan_workspace_fill BEFORE INSERT OR UPDATE ON xeno_account_plans
  FOR EACH ROW EXECUTE FUNCTION xeno_account_plan_workspace_fill();

-- DOWN
DROP TRIGGER IF EXISTS xeno_account_plan_workspace_fill ON xeno_account_plans;
DROP FUNCTION IF EXISTS xeno_account_plan_workspace_fill();
DROP INDEX IF EXISTS uq_xeno_account_plans_workspace;
ALTER TABLE xeno_account_plans DROP COLUMN IF EXISTS workspace_id;
