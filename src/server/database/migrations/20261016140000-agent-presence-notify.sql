-- UP
-- Agent presence, live (owner, 2026-10-16: "full real runtime logic"). Presence is derived from rows other code
-- already writes (agentPresence.js); these triggers only ANNOUNCE that one of them changed, on the channel
-- `agent_presence`, with the agent's user id as the payload. Every replica LISTENs and pushes the agent's new
-- presence to the screens watching it (GET /api/agents/presence/stream). A trigger, not a call in each service,
-- because the facts are written from many places (tasks, MCP, runs, credentials) and a forgotten call would leave a
-- screen silently stale. NOTIFY is transactional: nothing is announced for a write that rolls back.
CREATE OR REPLACE FUNCTION agent_presence_announce() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE who uuid;
BEGIN
  IF TG_TABLE_NAME = 'task_agent_sessions' OR TG_TABLE_NAME = 'agent_cloud_runs' OR TG_TABLE_NAME = 'task_agent_tokens' OR TG_TABLE_NAME = 'mcp_connections' THEN
    who := COALESCE(NEW.agent_user_id, OLD.agent_user_id);
  END IF;
  IF who IS NOT NULL THEN PERFORM pg_notify('agent_presence', who::text); END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS agent_presence_sessions ON task_agent_sessions;
CREATE TRIGGER agent_presence_sessions AFTER INSERT OR UPDATE OR DELETE ON task_agent_sessions FOR EACH ROW EXECUTE FUNCTION agent_presence_announce();
DROP TRIGGER IF EXISTS agent_presence_runs ON agent_cloud_runs;
CREATE TRIGGER agent_presence_runs AFTER INSERT OR UPDATE OF state, credential_id ON agent_cloud_runs FOR EACH ROW EXECUTE FUNCTION agent_presence_announce();
-- a credential or connection being USED moves `last_used_at`; announce only when it crosses into "seen" again or is
-- revoked, not on every call (an active agent makes many calls a minute)
DROP TRIGGER IF EXISTS agent_presence_tokens ON task_agent_tokens;
CREATE TRIGGER agent_presence_tokens AFTER UPDATE OF last_used_at, revoked_at ON task_agent_tokens FOR EACH ROW
  WHEN (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR OLD.last_used_at IS NULL OR NEW.last_used_at - OLD.last_used_at > interval '60 seconds')
  EXECUTE FUNCTION agent_presence_announce();
DROP TRIGGER IF EXISTS agent_presence_tokens_new ON task_agent_tokens;
CREATE TRIGGER agent_presence_tokens_new AFTER INSERT ON task_agent_tokens FOR EACH ROW EXECUTE FUNCTION agent_presence_announce();
DROP TRIGGER IF EXISTS agent_presence_connections ON mcp_connections;
CREATE TRIGGER agent_presence_connections AFTER UPDATE OF last_used_at, revoked_at ON mcp_connections FOR EACH ROW
  WHEN (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR OLD.last_used_at IS NULL OR NEW.last_used_at - OLD.last_used_at > interval '60 seconds')
  EXECUTE FUNCTION agent_presence_announce();

-- DOWN
DROP TRIGGER IF EXISTS agent_presence_sessions ON task_agent_sessions;
DROP TRIGGER IF EXISTS agent_presence_runs ON agent_cloud_runs;
DROP TRIGGER IF EXISTS agent_presence_tokens ON task_agent_tokens;
DROP TRIGGER IF EXISTS agent_presence_tokens_new ON task_agent_tokens;
DROP TRIGGER IF EXISTS agent_presence_connections ON mcp_connections;
DROP FUNCTION IF EXISTS agent_presence_announce();
