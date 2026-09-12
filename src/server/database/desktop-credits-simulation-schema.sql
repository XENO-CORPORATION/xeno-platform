CREATE TABLE IF NOT EXISTS billing_payment_method_snapshots (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES billing_workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand VARCHAR(32) NOT NULL,
  last4 VARCHAR(4) NOT NULL,
  exp_month INTEGER NOT NULL CHECK (exp_month BETWEEN 1 AND 12),
  exp_year INTEGER NOT NULL CHECK (exp_year BETWEEN 2000 AND 9999),
  cardholder_name VARCHAR(255) NOT NULL,
  country VARCHAR(64) NOT NULL,
  address_line1 VARCHAR(255),
  address_line2 VARCHAR(255),
  city VARCHAR(128),
  state VARCHAR(128),
  postal_code VARCHAR(64),
  tax_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_payment_method_snapshots_user_id
  ON billing_payment_method_snapshots (user_id);

CREATE INDEX IF NOT EXISTS idx_billing_payment_method_snapshots_workspace_id
  ON billing_payment_method_snapshots (workspace_id);
