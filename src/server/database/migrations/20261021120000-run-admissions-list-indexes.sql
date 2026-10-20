-- UP
-- XENO-WORKFORCE-01 NFR-04: POST /api/workforce/run-admissions/list pages a PROJECT's or an AGENT's admissions
-- newest first (services/workforceRunAdmission.js listRunAdmissions: ORDER BY admitted_at DESC, id LIMIT n).
-- The project filter had no index, so a project list scanned the whole table; the agent index lacked the `id`
-- tiebreak the ORDER BY uses. ADDITIVE ONLY: two indexes. DOWN drops exactly them.
CREATE INDEX IF NOT EXISTS workforce_run_admissions_project_list ON workforce_run_admissions(project_id, admitted_at DESC, id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS workforce_run_admissions_agent_list ON workforce_run_admissions(agent_resource_id, admitted_at DESC, id);
-- DOWN
DROP INDEX IF EXISTS workforce_run_admissions_agent_list;
DROP INDEX IF EXISTS workforce_run_admissions_project_list;
