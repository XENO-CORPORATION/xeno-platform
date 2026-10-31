-- The work report (services/workforceEvaluation.js, owner 2026-10-29) reads what an AGENT spent: usage rows whose
-- dimensions name the agent (utils/usageDimensions.js agent_user_id). api_usage_logs is indexed by payer and time
-- only, so that read would scan the table. A partial expression index over the rows that carry an agent.
-- Additive; no data change.
-- UP
CREATE INDEX IF NOT EXISTS api_usage_logs_agent_time
  ON api_usage_logs ((dimensions->>'agent_user_id'), created_at)
  WHERE dimensions ? 'agent_user_id';

-- DOWN
DROP INDEX IF EXISTS api_usage_logs_agent_time;
