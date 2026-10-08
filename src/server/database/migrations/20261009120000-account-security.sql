-- UP
-- Account: "confirm it's you", email change, personal API keys, data export.
--
-- account_confirmations: a person proved, a moment ago and in THIS browser session, that they are
-- the account's owner. Sensitive routes ask for one. It belongs to the session, not the account:
-- confirming on one device says nothing about another.
CREATE TABLE IF NOT EXISTS account_confirmations (
  sid          UUID PRIMARY KEY REFERENCES user_sessions(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method       TEXT NOT NULL CHECK (method IN ('password', 'email_code')),
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  CHECK (expires_at > confirmed_at)
);

-- One live six-digit code per account and purpose. Only a keyed hash is stored. A new code
-- replaces the old one; five wrong tries end it.
CREATE TABLE IF NOT EXISTS account_codes (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose      TEXT NOT NULL CHECK (purpose IN ('confirm', 'email_change')),
  code_hash    TEXT NOT NULL,
  target_email TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, purpose),
  CHECK ((purpose = 'email_change') = (target_email IS NOT NULL))
);

-- Wrong passwords at the confirm step, counted per account, so the step cannot be used to guess one.
CREATE TABLE IF NOT EXISTS account_confirm_throttle (
  user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  failures          INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A copy of a person's data, built in the background and kept for a few days.
CREATE TABLE IF NOT EXISTS account_exports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'building' CHECK (status IN ('building', 'ready', 'failed', 'expired')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ready_at     TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  storage_path TEXT,
  size_bytes   BIGINT,
  summary      JSONB NOT NULL DEFAULT '{}'::jsonb,
  error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_account_exports_user ON account_exports (user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_exports_expiry ON account_exports (expires_at) WHERE status = 'ready';

-- DOWN
DROP TABLE IF EXISTS account_exports;
DROP TABLE IF EXISTS account_confirm_throttle;
DROP TABLE IF EXISTS account_codes;
DROP TABLE IF EXISTS account_confirmations;
