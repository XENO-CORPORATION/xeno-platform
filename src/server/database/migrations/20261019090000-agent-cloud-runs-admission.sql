-- UP
-- XENO-WORKFORCE-01 RUN-01 / RUN-03: a cloud run started from the agent page is ADMITTED first, and runs under that
-- admission. The admission (workforce_run_admissions) is the authority record; this column is only the edge to it.
-- The database holds the same rules the service holds:
--   - a NEW run names an admission, made by the run's own person, for the agent's own definition;
--   - a credential is issued only while that admission (and every ancestor) is unrevoked.
-- Rows written before this migration have no admission and are left alone (they can no longer mint a credential
-- unless they already hold one -- see the guard), so the migration is additive and its DOWN is exact.
ALTER TABLE agent_cloud_runs ADD COLUMN IF NOT EXISTS admission_id uuid NULL REFERENCES workforce_run_admissions(id);
CREATE UNIQUE INDEX IF NOT EXISTS agent_cloud_runs_admission_key ON agent_cloud_runs (admission_id) WHERE admission_id IS NOT NULL;

CREATE OR REPLACE FUNCTION agent_cloud_runs_admission_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a record;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.admission_id IS NULL THEN
    RAISE EXCEPTION 'a cloud run is admitted before it starts' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.admission_id IS DISTINCT FROM OLD.admission_id THEN
    RAISE EXCEPTION 'a cloud run never changes its admission' USING ERRCODE = '23514';
  END IF;
  IF NEW.admission_id IS NOT NULL THEN
    SELECT r.actor_user_id, r.agent_resource_id, i.workforce_resource_id INTO a
      FROM workforce_run_admissions r JOIN agent_identities i ON i.user_id = NEW.agent_user_id WHERE r.id = NEW.admission_id;
    IF a IS NULL OR a.actor_user_id <> NEW.owner_user_id OR a.agent_resource_id IS DISTINCT FROM a.workforce_resource_id THEN
      RAISE EXCEPTION 'a cloud run is admitted by its own person, for its own agent' USING ERRCODE = '23514';
    END IF;
  END IF;
  -- a credential is minted only under live authority; a run with no admission mints none
  IF NEW.credential_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.credential_id IS NULL) THEN
    IF NEW.admission_id IS NULL OR workforce_run_admission_fence(NEW.admission_id) IS NOT NULL THEN
      RAISE EXCEPTION 'a revoked or unadmitted run is issued no credential' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS agent_cloud_runs_admission_guard ON agent_cloud_runs;
CREATE TRIGGER agent_cloud_runs_admission_guard BEFORE INSERT OR UPDATE ON agent_cloud_runs
  FOR EACH ROW EXECUTE FUNCTION agent_cloud_runs_admission_guard();

-- DOWN
DROP TRIGGER IF EXISTS agent_cloud_runs_admission_guard ON agent_cloud_runs;
DROP FUNCTION IF EXISTS agent_cloud_runs_admission_guard();
DROP INDEX IF EXISTS agent_cloud_runs_admission_key;
ALTER TABLE agent_cloud_runs DROP COLUMN IF EXISTS admission_id;
