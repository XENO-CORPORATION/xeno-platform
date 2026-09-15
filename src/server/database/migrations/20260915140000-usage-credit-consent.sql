-- UP
-- Absence of a preference is explicitly OFF. No existing account is opted in.
CREATE TABLE IF NOT EXISTS usage_credit_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS usage_credit_consent_events (
  id bigserial PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
  enabled boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS credit_hold_funding (
  hold_row_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  reserved_micro bigint NOT NULL CHECK (reserved_micro > 0),
  draw_order integer NOT NULL,
  PRIMARY KEY (hold_row_id, grant_id)
);
CREATE INDEX IF NOT EXISTS idx_credit_hold_funding_grant ON credit_hold_funding(grant_id);
-- No foreign keys to the legacy holds/grants: bootstrap creates them after versioned
-- migrations on a fresh database. All writes are inside the account-locked ledger transaction.

-- DOWN
-- Consent and funding evidence must survive rollback. Forward repair only.
