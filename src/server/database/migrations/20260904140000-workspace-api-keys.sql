-- UP
-- Distinct, least-privilege credentials. Never insert these into legacy api_keys:
-- that table authenticates an unscoped user on old Platform/gateway builds.
CREATE TABLE IF NOT EXISTS workspace_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  key_prefix VARCHAR(24) NOT NULL,
  key_hash CHAR(64) NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL CHECK (cardinality(scopes) BETWEEN 1 AND 2
    AND scopes <@ ARRAY['workspace:read','workspace:members:read']::TEXT[]),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  replaced_by UUID REFERENCES workspace_api_keys(id),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS workspace_api_keys_workspace_idx ON workspace_api_keys(workspace_id, created_at DESC);
-- DOWN
DROP TABLE IF EXISTS workspace_api_keys;
