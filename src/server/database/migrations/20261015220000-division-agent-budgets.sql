-- UP
-- DIV-07 for platform agents: a division's AGENT budget. A workspace admin sets how many credits the division's
-- agents may spend per period. Every agent spend (media generations, model calls made through the agent tools)
-- reads it before spending, and an agent in a division whose budget is used up is refused with the reason.
--
-- No balance is stored here, exactly as DIV-07 says ("a reference, never a balance and never a wallet"): the money
-- still moves on the owner's ledger, and the division's spend is DERIVED from the agent-spend log below, which
-- every agent spend writes in the same transaction as its decision. A limit and a window; nothing to reconcile.
--
-- `auto_approve`: when on, an agent's media generation inside the budget runs without waiting for its owner to
-- approve it (the budget IS the approval, set by a workspace admin). Off: every generation waits, as before.

CREATE TABLE IF NOT EXISTS division_agent_budgets (
  division_id uuid PRIMARY KEY REFERENCES workforce_divisions(id) ON DELETE RESTRICT,
  limit_micro bigint NOT NULL CHECK (limit_micro >= 0),
  window_days integer NOT NULL DEFAULT 30 CHECK (window_days BETWEEN 1 AND 366),
  auto_approve boolean NOT NULL DEFAULT false,
  set_by_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per agent spend decision: who spent, against which division, how much, on what. Append-only.
CREATE TABLE IF NOT EXISTS agent_spend_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  division_id uuid NULL REFERENCES workforce_divisions(id) ON DELETE SET NULL,
  payer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('image', 'video', 'model')),
  ref text NULL CHECK (ref IS NULL OR char_length(ref) <= 200),
  amount_micro bigint NOT NULL CHECK (amount_micro >= 0),
  -- 'reserved' when committed, 'released' when the work failed or was cancelled and nothing was charged
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'released')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_spend_log_division ON agent_spend_log (division_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_spend_log_agent ON agent_spend_log (agent_user_id, created_at DESC);

-- the log may only move reserved -> released; nothing else changes and nothing is deleted
CREATE OR REPLACE FUNCTION agent_spend_log_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'agent spend history is append-only' USING ERRCODE = '23514'; END IF;
  IF NEW.state = 'released' AND OLD.state = 'reserved'
     AND NEW.agent_user_id = OLD.agent_user_id AND NEW.division_id IS NOT DISTINCT FROM OLD.division_id
     AND NEW.payer_user_id = OLD.payer_user_id AND NEW.kind = OLD.kind AND NEW.ref IS NOT DISTINCT FROM OLD.ref
     AND NEW.amount_micro = OLD.amount_micro AND NEW.created_at = OLD.created_at THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'agent spend history is append-only' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS agent_spend_log_guard ON agent_spend_log;
CREATE TRIGGER agent_spend_log_guard BEFORE UPDATE OR DELETE ON agent_spend_log
  FOR EACH ROW EXECUTE FUNCTION agent_spend_log_guard();

-- a platform agent's own credential connection (client_id 'agent:<agt id>') reaches every agent service; a
-- person's OAuth connection keeps its own choice. Existing agent connections only ever had Tasks because nothing
-- else existed: give them the new services too (only where the owner never narrowed them).
UPDATE mcp_connections SET categories = ARRAY['tasks','image','video','library','chat']
  WHERE client_id LIKE 'agent:%' AND revoked_at IS NULL AND categories = '{tasks}';

-- DOWN
DROP TRIGGER IF EXISTS agent_spend_log_guard ON agent_spend_log;
DROP FUNCTION IF EXISTS agent_spend_log_guard();
DROP TABLE IF EXISTS agent_spend_log;
DROP TABLE IF EXISTS division_agent_budgets;
