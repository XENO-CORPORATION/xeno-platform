-- UP
-- The agent page's controls (owner, 2026-10-24: the agent page redesign). Two things a person can now do from it:
--   1. pause ONE place an agent runs: an MCP connection with paused_at set is refused on its next call
--      (routes/xenoMcpRoutes.js callerOf), and works again the moment it is resumed. Disconnect stays revoked_at.
--   2. cap what ONE agent spends through XENO tools over a rolling 30 days (images, video, model calls). Enforced
--      where every such spend is reserved (divisionAgentBudget.reserve), under the same lock discipline as the
--      division budget. A cloud run keeps its own per-run budget; this cap does not cover it.
-- ADDITIVE ONLY: one nullable column and one table. DOWN removes exactly them.
ALTER TABLE mcp_connections ADD COLUMN IF NOT EXISTS paused_at timestamptz NULL;

CREATE TABLE IF NOT EXISTS agent_spend_caps (
  agent_user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  limit_micro bigint NOT NULL CHECK (limit_micro >= 0),
  set_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- per-agent spend over a window is read on every reserve: index the read
CREATE INDEX IF NOT EXISTS agent_spend_log_agent ON agent_spend_log (agent_user_id, created_at DESC);

-- DOWN
DROP INDEX IF EXISTS agent_spend_log_agent;
DROP TABLE IF EXISTS agent_spend_caps;
ALTER TABLE mcp_connections DROP COLUMN IF EXISTS paused_at;
