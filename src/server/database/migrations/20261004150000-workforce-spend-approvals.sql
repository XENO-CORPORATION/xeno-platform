-- ACCT-07: explicit bounded spend approvals for agent-originated gifts/contributions.
-- An agent never spends on its own authority: its owner (a usable human) grants a bounded
-- approval -- one operation, one agent, a maximum amount, an expiry, an optional target --
-- and every spend re-resolves the agent's CURRENT owner before consuming. Ownership drift,
-- suspension or revocation kills the approval even mid-flight.
CREATE TABLE IF NOT EXISTS workforce_spend_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  agent_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_id TEXT NOT NULL CHECK (client_id ~ '^[A-Za-z0-9._-]{1,128}$'),
  operation_id UUID NOT NULL,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  operation TEXT NOT NULL CHECK (operation IN ('gift','contribute')),
  max_amount_micro BIGINT NOT NULL CHECK (max_amount_micro > 0),
  spent_amount_micro BIGINT NOT NULL DEFAULT 0 CHECK (spent_amount_micro >= 0),
  target JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(target) = 'object'),
  expires_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','exhausted','revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id, client_id, operation_id),
  CHECK (spent_amount_micro <= max_amount_micro),
  CHECK (owner_user_id != agent_user_id)
);
CREATE INDEX IF NOT EXISTS workforce_spend_approvals_agent ON workforce_spend_approvals(agent_user_id, state);

-- Gifts name their payer as sender (the money view stays exact) and record the
-- originator separately: for human gifts they coincide; for agent gifts the sender is
-- the approval's owner and the originator is the agent. Backfill, then enforce.
-- Every statement below is re-runnable: the payment-origin suite rolls the funding
-- schema back and re-applies post-foundation files (see its rollback test).
ALTER TABLE workforce_gifts ADD COLUMN IF NOT EXISTS approval_id UUID NULL REFERENCES workforce_spend_approvals(id) ON DELETE RESTRICT;
ALTER TABLE workforce_gifts ADD COLUMN IF NOT EXISTS originator_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT;
UPDATE workforce_gifts SET originator_user_id = sender_user_id WHERE originator_user_id IS NULL;
ALTER TABLE workforce_gifts ALTER COLUMN originator_user_id SET NOT NULL;
ALTER TABLE workforce_gifts DROP CONSTRAINT IF EXISTS workforce_gifts_sender_user_id_client_id_operation_id_key;
ALTER TABLE workforce_gifts DROP CONSTRAINT IF EXISTS workforce_gifts_sender_originator_client_operation_key;
ALTER TABLE workforce_gifts ADD CONSTRAINT workforce_gifts_sender_originator_client_operation_key
  UNIQUE(sender_user_id, originator_user_id, client_id, operation_id);

-- Contributions keep contributor as the originator; the payer defaults to the
-- contributor and is the approval's owner for agent-originated contributions.
ALTER TABLE workforce_funding_contributions ADD COLUMN IF NOT EXISTS approval_id UUID NULL REFERENCES workforce_spend_approvals(id) ON DELETE RESTRICT;
ALTER TABLE workforce_funding_contributions ADD COLUMN IF NOT EXISTS payer_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT;

-- The commit-time lineage guard must accept the payer's grants, not just the
-- contributor's: for agent-originated contributions the origin lots belong to the
-- approval's owner. Every other clause is unchanged.
CREATE OR REPLACE FUNCTION workforce_contribution_balance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c record; total numeric; p record; bad integer; funding_user uuid;
BEGIN
  SELECT * INTO c FROM workforce_funding_contributions WHERE id=NEW.id;
  IF c.state='pending' THEN RAISE EXCEPTION 'pending contribution cannot commit without confirmed funding' USING ERRCODE='23514'; END IF;
  funding_user := COALESCE(c.payer_user_id, c.contributor_user_id);
  SELECT * INTO p FROM workforce_funding_pools WHERE campaign_id=c.campaign_id AND milestone_id=c.milestone_id;
  SELECT coalesce(sum(amount_micro),0) INTO total FROM workforce_contribution_lots WHERE contribution_id=c.id;
  IF total<>c.amount_micro OR p.id IS NULL THEN RAISE EXCEPTION 'contribution lot total disagrees with receipt' USING ERRCODE='23514'; END IF;
  SELECT count(*) INTO bad FROM workforce_contribution_lots l
    LEFT JOIN credit_grants source ON source.id=l.origin_grant_id
    LEFT JOIN credit_grant_payment_origins o ON o.grant_id=source.id
    LEFT JOIN credit_grants dest ON dest.id=l.pool_grant_id
    WHERE l.contribution_id=c.id AND (source.id IS NULL OR o.grant_id IS NULL OR dest.id IS NULL
      OR source.user_id<>funding_user OR dest.user_id<>p.id OR dest.account_id<>p.account_id
      OR dest.kind<>'contribution' OR dest.amount_micro<>l.amount_micro
      OR source.expires_at IS DISTINCT FROM dest.expires_at OR source.expires_at IS DISTINCT FROM l.origin_expires_at);
  IF bad<>0 THEN RAISE EXCEPTION 'contribution lineage or expiry mismatch' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
