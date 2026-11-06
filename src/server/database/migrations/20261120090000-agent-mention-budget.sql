-- UP
-- A wake reads the channel, the agent's brief and its tools before it can say anything: about 50 credits on the current
-- model, so 10 ran out before the reply. Rows already saved keep what their person chose.
ALTER TABLE agent_mention_settings ALTER COLUMN budget_credits SET DEFAULT 50;
ALTER TABLE agent_mention_settings DROP CONSTRAINT IF EXISTS agent_mention_settings_budget_credits_check;
ALTER TABLE agent_mention_settings ADD CONSTRAINT agent_mention_settings_budget_credits_check CHECK (budget_credits BETWEEN 1 AND 200);

-- DOWN
UPDATE agent_mention_settings SET budget_credits = 50 WHERE budget_credits > 50;
ALTER TABLE agent_mention_settings DROP CONSTRAINT IF EXISTS agent_mention_settings_budget_credits_check;
ALTER TABLE agent_mention_settings ADD CONSTRAINT agent_mention_settings_budget_credits_check CHECK (budget_credits BETWEEN 1 AND 50);
ALTER TABLE agent_mention_settings ALTER COLUMN budget_credits SET DEFAULT 10;
