-- UP
-- XENO WORKSPACE AGENT SURFACE - SPEC.md P2 (approved by the owner 2026-10-20, "yes to all"): HEADLESS scoped keys.
-- `xwk_` generalises the Tasks `xtk_` credential to every area: the same per-area scopes as an OAuth sign-in on the
-- `xeno-workspace` audience, bound to ONE workspace, acting as the person's own per-app agent, with an expiry that
-- is REQUIRED (no key lives forever). Only the key's SHA-256 is stored; the key itself is shown once.
-- What a key may do is NOT stored here: it is the workspace grants (relationship_tuples
-- object_type='capability', object_id='<capability>@<workspace>', relation='grantee', subject=user:<agent>) — the one
-- grant store (§8.11 D-3). ADDITIVE ONLY: one new table. DOWN drops exactly it.
CREATE TABLE IF NOT EXISTS workspace_agent_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_sha256 text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  scopes text[] NOT NULL CHECK (cardinality(scopes) > 0),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS workspace_agent_keys_owner ON workspace_agent_keys (owner_user_id) WHERE revoked_at IS NULL;
-- DOWN
DROP INDEX IF EXISTS workspace_agent_keys_owner;
DROP TABLE IF EXISTS workspace_agent_keys;
