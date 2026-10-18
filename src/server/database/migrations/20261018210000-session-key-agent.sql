-- UP
-- Session keys gain two optional, server-set facts (2026-10-18, XENO Spawn):
--   agent_user_id   the agent the key runs AS. The person still pays (user_id and the billing link are unchanged); this
--                   only names who spent it, so metered usage can be attributed to the agent and its division budget.
--                   Set by the mint route after its run-right check, never from a header on a model call.
--   max_spend_micro the most this key may ever spend (settled plus outstanding holds). The ledger refuses a hold that
--                   would pass it, under the account lock, so concurrent calls cannot overshoot.
-- credit_holds.api_key_id records which key a reservation was made with, so outstanding holds count against that cap
-- and the settle's usage row names the key. All three are additive and nullable: a key minted without them, and every
-- hold made without a key, behaves exactly as before.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS agent_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS max_spend_micro bigint CHECK (max_spend_micro IS NULL OR max_spend_micro > 0);
CREATE INDEX IF NOT EXISTS idx_api_keys_agent_user ON api_keys (agent_user_id) WHERE agent_user_id IS NOT NULL;
ALTER TABLE credit_holds ADD COLUMN IF NOT EXISTS api_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_credit_holds_api_key_held ON credit_holds (api_key_id) WHERE api_key_id IS NOT NULL AND state = 'held';

-- DOWN
DROP INDEX IF EXISTS idx_credit_holds_api_key_held;
ALTER TABLE credit_holds DROP COLUMN IF EXISTS api_key_id;
DROP INDEX IF EXISTS idx_api_keys_agent_user;
ALTER TABLE api_keys DROP COLUMN IF EXISTS max_spend_micro;
ALTER TABLE api_keys DROP COLUMN IF EXISTS agent_user_id;
