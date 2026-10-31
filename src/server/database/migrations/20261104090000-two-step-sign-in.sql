-- Two-step sign-in: an authenticator app (RFC 6238), passkeys (WebAuthn) and single-use recovery codes.
-- Every table is new and a person opts in, so an account with none of these rows signs in exactly as before.
-- A passkey's relying party is written into the authenticator and cannot move, so PASSKEY_RP_ID stays xenosystem.ai.
CREATE TABLE IF NOT EXISTS account_totp (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_enc   TEXT NOT NULL,                 -- utils/secretBox.js: the app's secret, needed in the clear to check a code
  confirmed_at TIMESTAMPTZ,                   -- null while setting up: it counts for nothing until a code proves it works
  last_step    BIGINT NOT NULL DEFAULT 0,     -- a code's time step works once
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS account_passkeys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key    BYTEA NOT NULL,
  counter       BIGINT NOT NULL DEFAULT 0,
  transports    TEXT[] NOT NULL DEFAULT '{}',
  backed_up     BOOLEAN NOT NULL DEFAULT false,
  name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_account_passkeys_user ON account_passkeys(user_id);
CREATE TABLE IF NOT EXISTS account_recovery_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,                   -- keyed hash; the code itself is shown once and never stored
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, code_hash)
);
-- The state between the first step and the second. No session exists until the second succeeds.
CREATE TABLE IF NOT EXISTS two_step_challenges (
  token_hash  TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL CHECK (mode IN ('browser', 'preview', 'token', 'oauth')),
  return_url  TEXT CHECK (return_url IS NULL OR length(return_url) <= 2000),
  is_new      BOOLEAN NOT NULL DEFAULT false,
  attempts    INT NOT NULL DEFAULT 0,
  webauthn_challenge TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_two_step_challenges_user ON two_step_challenges(user_id);
-- One passkey ceremony: the challenge the authenticator must sign, used once.
CREATE TABLE IF NOT EXISTS webauthn_ceremonies (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('register', 'sign_in', 'confirm')),
  challenge  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS two_step_throttle (
  user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  failures          INT NOT NULL DEFAULT 0,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE IF EXISTS account_confirmations DROP CONSTRAINT IF EXISTS account_confirmations_method_check;
ALTER TABLE IF EXISTS account_confirmations ADD CONSTRAINT account_confirmations_method_check CHECK (method IN ('password', 'email_code', 'authenticator', 'passkey', 'recovery_code'));

-- DOWN
ALTER TABLE account_confirmations DROP CONSTRAINT IF EXISTS account_confirmations_method_check;
DELETE FROM account_confirmations WHERE method NOT IN ('password', 'email_code');
ALTER TABLE account_confirmations ADD CONSTRAINT account_confirmations_method_check CHECK (method IN ('password', 'email_code'));
DROP TABLE IF EXISTS two_step_throttle;
DROP TABLE IF EXISTS webauthn_ceremonies;
DROP TABLE IF EXISTS two_step_challenges;
DROP TABLE IF EXISTS account_recovery_codes;
DROP TABLE IF EXISTS account_passkeys;
DROP TABLE IF EXISTS account_totp;
