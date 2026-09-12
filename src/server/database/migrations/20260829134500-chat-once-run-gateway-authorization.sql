-- UP
-- A one-time task is marked paused/completed_once as soon as its sole
-- occurrence is dispatched.  That terminal scheduling state prevents another
-- occurrence from being created, but must not revoke the already-authorized
-- run while the worker is executing (or while the user retries that same run).
CREATE OR REPLACE VIEW chat_gateway_dispatch_authorizations
WITH (security_barrier = true)
AS
SELECT r.id AS run_key, t.run_as_user_id AS user_id
FROM chat_scheduled_runs r
JOIN chat_scheduled_tasks t ON t.id = r.task_id
WHERE r.status = 'running'
  AND (
    t.status = 'active'
    OR (t.status = 'paused' AND t.paused_reason = 'completed_once')
  )
  AND t.run_as_user_id IS NOT NULL;

REVOKE ALL ON chat_gateway_dispatch_authorizations FROM PUBLIC;
COMMENT ON VIEW chat_gateway_dispatch_authorizations IS
  'Least-privilege current run-key/principal authorization surface; includes the in-flight occurrence of an automatically completed one-time task.';
