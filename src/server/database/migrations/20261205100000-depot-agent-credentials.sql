-- UP
-- XENO Depot credentials for headless agents (xeno-depot decision 0001 §3: "Headless agents: an xdp_ credential bound to
-- a platform agent (agt_), owner-capped like every agent"; decision 0002 §2: Runner reads Depot with one). The XENO Tasks
-- shape (task_agent_tokens): `xdp_<prefix>_<secret>`, the prefix finds the row, the SHA-256 of the whole token proves it,
-- the secret is shown once and never stored. Scopes are Depot's own and nothing else, so the credential can never reach
-- another API. Who may do what on a repo stays in the repo's grants (services/depotAuthority.js): an agent holding one of
-- these acts as ITSELF, with its own grants cut to its owner's.
CREATE TABLE IF NOT EXISTS depot_agent_credentials (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_prefix   TEXT NOT NULL UNIQUE CHECK (token_prefix ~ '^[a-z0-9]{12}$'),
  token_hash     TEXT NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  agent_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scopes         TEXT[] NOT NULL CHECK (scopes <@ ARRAY['depot:read', 'depot:write', 'depot:admin']::text[] AND cardinality(scopes) >= 1),
  label          TEXT NOT NULL DEFAULT '' CHECK (length(label) <= 80),
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  last_used_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at <= created_at + interval '366 days')
);
CREATE INDEX IF NOT EXISTS idx_depot_agent_credentials_agent ON depot_agent_credentials(agent_user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_depot_agent_credentials_owner ON depot_agent_credentials(owner_user_id) WHERE revoked_at IS NULL;

-- DOWN
-- Refused while a live credential exists: dropping the table would silently cut off an agent (Runner) mid-use.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM depot_agent_credentials WHERE revoked_at IS NULL AND expires_at > now()) THEN
    RAISE EXCEPTION 'depot agent credentials rollback refused: live credentials exist; revoke them first' USING ERRCODE = '23514';
  END IF;
END $$;
DROP TABLE IF EXISTS depot_agent_credentials;
