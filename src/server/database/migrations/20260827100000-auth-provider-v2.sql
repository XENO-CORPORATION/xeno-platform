-- XENO ecosystem auth provider prerequisites, additive and rollback-tolerant.
-- Session state lives beside existing refresh rows so the live tables do not
-- need destructive shape changes. Revocation is durable and access-JWT aware.

CREATE TABLE IF NOT EXISTS oauth_user_auth_epochs (
  user_id     uuid PRIMARY KEY,
  epoch       bigint NOT NULL DEFAULT 0,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_session_state (
  sid         uuid PRIMARY KEY,
  user_id     uuid NOT NULL,
  auth_epoch  bigint NOT NULL,
  auth_time   timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oauth_session_user
  ON oauth_session_state (user_id, revoked_at, expires_at);
