-- Sender-constrained broker token exchange. Additive to the session-state
-- tables introduced immediately before this migration.

ALTER TABLE oauth_session_state ADD COLUMN IF NOT EXISTS dpop_jkt text;

CREATE TABLE IF NOT EXISTS oauth_dpop_replays (
  jkt         text NOT NULL,
  jti         text NOT NULL,
  htm         varchar(16) NOT NULL,
  htu         text NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (jkt, jti)
);

CREATE TABLE IF NOT EXISTS oauth_broker_installations (
  installation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL,
  public_jwk       jsonb NOT NULL,
  jkt              text NOT NULL,
  revoked_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, jkt)
);

CREATE TABLE IF NOT EXISTS oauth_broker_assertion_replays (
  installation_id uuid NOT NULL,
  jti              text NOT NULL,
  expires_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, jti)
);
