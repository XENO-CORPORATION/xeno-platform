-- XENO-WORKFORCE-01 MKT-06: a marketplace invocation is a durable record of a hosted run the platform
-- asked xeno-agents-api to create on the buyer's behalf. It is written BEFORE dispatch, so a lost
-- response is reconciled (the same idempotency key adopts the run that was created) instead of re-sent.
-- It carries no money: agents-api holds on admission and settles from real usage; the columns below
-- only mirror what agents-api reported.
CREATE TABLE IF NOT EXISTS marketplace_invocations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL,
  listing_id         UUID NOT NULL REFERENCES marketplace_listings(id),
  access             VARCHAR(20) NOT NULL CHECK (access IN ('rental','subscribed','pay_per_use')),
  prompt             TEXT NOT NULL CHECK (length(prompt) BETWEEN 1 AND 100000),
  max_credits        NUMERIC,
  state              VARCHAR(16) NOT NULL DEFAULT 'pending'
                     CHECK (state IN ('pending','dispatched','uncertain','refused','finished')),
  run_id             TEXT,
  run_status         TEXT,
  run_status_reason  TEXT,
  credits_held       NUMERIC,
  credits_settled    NUMERIC,
  -- Every short-lived credential the broker minted for this invocation (oauth_session_state.sid).
  delegated_sids     UUID[] NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A run id belongs to exactly one invocation: a second invocation can never adopt someone else's run.
  CONSTRAINT marketplace_invocations_run_unique UNIQUE (run_id),
  -- 'dispatched' and 'finished' mean a run exists; nothing else may claim one.
  CONSTRAINT marketplace_invocations_run_when_dispatched
    CHECK ((state IN ('dispatched','finished')) = (run_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_mkt_invocations_user ON marketplace_invocations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mkt_invocations_reconcile ON marketplace_invocations (state, updated_at)
  WHERE state IN ('pending','uncertain');
