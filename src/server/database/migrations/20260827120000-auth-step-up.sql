-- Fresh-auth context is stored beside the ephemeral authorization code rather
-- than changing the established live code table.

CREATE TABLE IF NOT EXISTS oauth_authorization_context (
  code       text PRIMARY KEY,
  auth_time  timestamptz NOT NULL,
  prompt     varchar(32),
  acr        text,
  created_at timestamptz NOT NULL DEFAULT now()
);
