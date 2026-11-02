-- UP
-- Selling one agent (XENO-WORKFORCE-01 MKT-03, MKT-05, MKT-07; owner's go-ahead 2026-11-01). A `mind` listing could only carry an uploaded
-- .xanima, and nothing set `servable` or `serving_material`, so no agent could be rented outside a test. This lets a version be built by the
-- platform from one of the seller's agents, the way a team package is built from a team. ADDITIVE ONLY. DOWN drops exactly what this adds.
--
-- 1. A `mind` version may carry its definition (`agent_definition`) and that definition's hash. PUBLISHING one requires it to hold only the
--    allowlisted fields, which is the database's own rule, so it holds for a reviewer too. Published, it can't change, like every agent version.
-- 2. Being servable takes reviewed serving material. Rental context reads only reviewed material (MKT-07), so a servable version with none would
--    run as a blank agent while its renter paid for this one.
-- 3. An import records what was bought and what it became. It can't be rewritten.
ALTER TABLE marketplace_listing_versions
  ADD COLUMN IF NOT EXISTS agent_definition JSONB,
  ADD COLUMN IF NOT EXISTS agent_definition_hash TEXT CHECK (agent_definition_hash IS NULL OR agent_definition_hash ~ '^[0-9a-f]{64}$');
COMMENT ON COLUMN marketplace_listing_versions.agent_definition IS
  'A definition the platform built from one agent, from an allowlist. No memory, credentials, sessions or Soul. Never served to a page before purchase.';

CREATE OR REPLACE FUNCTION marketplace_agent_definition_valid(p JSONB) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(p) = 'object'
    AND p->>'format' = 'xeno-agent-package' AND p->'schemaVersion' = '1'::jsonb
    AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('format', 'schemaVersion', 'agent', 'persona', 'definition'))
    AND jsonb_typeof(p->'agent') = 'object' AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(p->'agent') k WHERE k NOT IN ('name', 'description'))
    AND length(p->'agent'->>'name') BETWEEN 1 AND 200
    AND (p->'persona' IS NULL OR jsonb_typeof(p->'persona') = 'null'
         OR (jsonb_typeof(p->'persona') = 'object' AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(p->'persona') k WHERE k NOT IN ('role', 'body'))))
    AND jsonb_typeof(p->'definition') = 'object'
    AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(p->'definition') k WHERE k NOT IN ('instructions', 'skills', 'requestedCapabilities', 'secretNames'))
    AND jsonb_typeof(p->'definition'->'instructions') = 'string'
    AND jsonb_typeof(p->'definition'->'skills') = 'array'
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p->'definition'->'skills') s, jsonb_object_keys(s) k WHERE k NOT IN ('id', 'version', 'hash'))
    AND jsonb_typeof(p->'definition'->'requestedCapabilities') = 'array'
    AND jsonb_typeof(p->'definition'->'secretNames') = 'array'
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p->'definition'->'secretNames') n WHERE jsonb_typeof(n) <> 'string')
$$;

CREATE OR REPLACE FUNCTION marketplace_agent_definition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE listing_kind TEXT;
BEGIN
  IF NEW.agent_definition IS NOT NULL OR NEW.agent_definition_hash IS NOT NULL THEN
    SELECT kind INTO listing_kind FROM marketplace_listings WHERE id = NEW.listing_id;
    IF listing_kind IS DISTINCT FROM 'mind' THEN
      RAISE EXCEPTION 'only a mind listing carries an agent definition' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.published_at IS NOT NULL
     AND ROW(NEW.agent_definition, NEW.agent_definition_hash) IS DISTINCT FROM ROW(OLD.agent_definition, OLD.agent_definition_hash) THEN
    RAISE EXCEPTION 'a published agent definition is immutable; publish a new version instead' USING ERRCODE = '23514';
  END IF;
  IF NEW.published_at IS NOT NULL AND NEW.agent_definition IS NOT NULL
     AND (NEW.agent_definition_hash IS NULL OR NOT marketplace_agent_definition_valid(NEW.agent_definition)) THEN
    RAISE EXCEPTION 'a published agent definition holds only the allowlisted fields' USING ERRCODE = '23514';
  END IF;
  IF NEW.servable AND NEW.agent_definition IS NOT NULL
     AND (NEW.serving_material IS NULL OR btrim(NEW.serving_material) = '' OR NEW.serving_material_reviewed_at IS NULL) THEN
    RAISE EXCEPTION 'a servable agent version needs reviewed serving material' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_agent_definition_guard ON marketplace_listing_versions;
CREATE TRIGGER marketplace_agent_definition_guard BEFORE INSERT OR UPDATE ON marketplace_listing_versions
  FOR EACH ROW EXECUTE FUNCTION marketplace_agent_definition_guard();

CREATE TABLE IF NOT EXISTS marketplace_agent_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES marketplace_listings(id) ON DELETE RESTRICT,
  listing_version_id uuid NOT NULL REFERENCES marketplace_listing_versions(id) ON DELETE RESTRICT,
  definition_hash text NOT NULL CHECK (definition_hash ~ '^[0-9a-f]{64}$'),
  license text NOT NULL,
  entitlement_id uuid NOT NULL REFERENCES marketplace_entitlements(id) ON DELETE RESTRICT,
  seller_developer_id uuid REFERENCES marketplace_developers(id) ON DELETE SET NULL,
  imported_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  target_workspace_id uuid REFERENCES workspaces(id) ON DELETE RESTRICT,
  agent_public_id text,   -- empty only while the copy is being made, which is what stops two imports making two agents
  required_secrets jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(required_secrets) = 'array'),
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_agent_imports_once ON marketplace_agent_imports
  (entitlement_id, listing_version_id, COALESCE(target_workspace_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- A finished import is a record. The one write it allows is filling in the agent it became.
CREATE OR REPLACE FUNCTION marketplace_agent_import_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.agent_public_id IS NOT NULL THEN
    RAISE EXCEPTION 'an agent import is retained and immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF ROW(NEW.id, NEW.listing_id, NEW.listing_version_id, NEW.definition_hash, NEW.license, NEW.entitlement_id, NEW.imported_by_user_id, NEW.target_workspace_id)
     IS DISTINCT FROM ROW(OLD.id, OLD.listing_id, OLD.listing_version_id, OLD.definition_hash, OLD.license, OLD.entitlement_id, OLD.imported_by_user_id, OLD.target_workspace_id) THEN
    RAISE EXCEPTION 'an agent import is retained and immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_agent_import_guard ON marketplace_agent_imports;
CREATE TRIGGER marketplace_agent_import_guard BEFORE UPDATE OR DELETE ON marketplace_agent_imports
  FOR EACH ROW EXECUTE FUNCTION marketplace_agent_import_guard();

-- DOWN
DROP TRIGGER IF EXISTS marketplace_agent_import_guard ON marketplace_agent_imports;
DROP FUNCTION IF EXISTS marketplace_agent_import_guard();
DROP TABLE IF EXISTS marketplace_agent_imports;
DROP TRIGGER IF EXISTS marketplace_agent_definition_guard ON marketplace_listing_versions;
DROP FUNCTION IF EXISTS marketplace_agent_definition_guard();
DROP FUNCTION IF EXISTS marketplace_agent_definition_valid(JSONB);
ALTER TABLE marketplace_listing_versions DROP COLUMN IF EXISTS agent_definition_hash;
ALTER TABLE marketplace_listing_versions DROP COLUMN IF EXISTS agent_definition;
