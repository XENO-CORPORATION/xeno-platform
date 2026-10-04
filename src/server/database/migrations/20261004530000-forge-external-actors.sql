-- UP
-- FORGE-06: external contributors exist without a XENO account.
-- Their public provider identity is mirrored as an external actor;
-- linking to a XENO user requires verification, and privileged
-- capabilities require explicit per-scope consent. Nothing here
-- creates a users row — that would be a fabricated billable user.
CREATE TABLE IF NOT EXISTS forge_external_actors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('github')),
  provider_actor_id TEXT NOT NULL CHECK (length(btrim(provider_actor_id)) BETWEEN 1 AND 64),
  login TEXT NOT NULL CHECK (length(btrim(login)) BETWEEN 1 AND 128),
  display_name TEXT NULL,
  avatar_url TEXT NULL,
  profile_url TEXT NULL,
  linked_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  verified_link BOOLEAN NOT NULL DEFAULT FALSE,
  verification_method TEXT NULL CHECK (verification_method IS NULL OR verification_method IN ('oauth', 'signed_nonce', 'maintainer_attestation')),
  verification_proof_ref TEXT NULL,
  verified_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_actor_id),
  CHECK (verified_link = FALSE OR (linked_user_id IS NOT NULL AND verification_method IS NOT NULL AND verification_proof_ref IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS forge_external_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES forge_external_actors(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('spending', 'private_access', 'agent_execution')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  granted_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ NULL,
  UNIQUE (actor_id, scope)
);
CREATE TABLE IF NOT EXISTS forge_external_works (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES forge_external_actors(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('pull_request', 'issue')),
  ref TEXT NOT NULL CHECK (length(btrim(ref)) BETWEEN 1 AND 256),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (actor_id, kind, ref)
);
CREATE INDEX IF NOT EXISTS idx_forge_external_actors_linked ON forge_external_actors(linked_user_id);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM forge_external_actors) THEN
    RAISE EXCEPTION 'external-actor rollback refused: actors exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE forge_external_works;
  DROP TABLE forge_external_consents;
  DROP TABLE forge_external_actors;
END $$;
