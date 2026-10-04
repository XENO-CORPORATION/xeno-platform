-- UP
-- FORGE-03: GitHub integration through approved Apps only, with
-- minimum installation permissions, short-lived scoped tokens, and
-- a ledger that keeps acting-as-installation separate from
-- human/agent attribution.
CREATE TABLE IF NOT EXISTS github_apps (
  app_id TEXT PRIMARY KEY CHECK (length(btrim(app_id)) BETWEEN 1 AND 64),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  approved_by_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ NULL
);
CREATE TABLE IF NOT EXISTS github_installations (
  installation_id TEXT PRIMARY KEY CHECK (length(btrim(installation_id)) BETWEEN 1 AND 64),
  app_id TEXT NOT NULL REFERENCES github_apps(app_id) ON DELETE RESTRICT,
  account TEXT NOT NULL CHECK (length(btrim(account)) BETWEEN 1 AND 200),
  permissions JSONB NOT NULL CHECK (jsonb_typeof(permissions) = 'object'),
  suspended BOOLEAN NOT NULL DEFAULT FALSE,
  registered_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS github_app_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id TEXT NOT NULL REFERENCES github_installations(installation_id) ON DELETE CASCADE,
  token_digest TEXT NOT NULL UNIQUE,
  repositories JSONB NOT NULL CHECK (jsonb_typeof(repositories) = 'array'),
  permissions JSONB NOT NULL CHECK (jsonb_typeof(permissions) = 'object'),
  expires_at TIMESTAMPTZ NOT NULL,
  minted_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  minted_for_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS idx_github_app_tokens_digest ON github_app_tokens(token_digest);
CREATE TABLE IF NOT EXISTS github_action_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id TEXT NOT NULL REFERENCES github_installations(installation_id) ON DELETE CASCADE,
  acted_as TEXT NOT NULL,
  attributed_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  attributed_kind TEXT NOT NULL CHECK (attributed_kind IN ('human', 'agent')),
  action TEXT NOT NULL CHECK (length(btrim(action)) BETWEEN 1 AND 120),
  target TEXT NOT NULL CHECK (length(btrim(target)) BETWEEN 1 AND 512),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_github_action_ledger_installation
  ON github_action_ledger(installation_id, created_at);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM github_action_ledger) THEN
    RAISE EXCEPTION 'github rollback refused: ledger entries exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM github_app_tokens WHERE expires_at > now()) THEN
    RAISE EXCEPTION 'github rollback refused: live tokens exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM github_installations) THEN
    RAISE EXCEPTION 'github rollback refused: installations exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM github_apps) THEN
    RAISE EXCEPTION 'github rollback refused: apps exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE github_action_ledger;
  DROP TABLE github_app_tokens;
  DROP TABLE github_installations;
  DROP TABLE github_apps;
END $$;
