-- UP
-- XENO-WORKFORCE-01 MKT-04, sold as listing kind `team` (D22, decided 2026-09-25):
--   "Exported team packages include authorized configuration and redistributable dependencies only.
--    Exclude human corporate memberships, credentials, active sessions, private Soul and
--    non-redistributable nested agents. Import creates a licensed instance with provenance, not the
--    seller's corporate team identity."
--
-- The service (services/marketplaceTeamPackages.js) BUILDS a package from one canonical team (D21)
-- and IMPORTS one into a new team. This migration holds what must be true whoever writes the rows:
--
-- 1. `team` is a listing kind. It is not `swarm`: a swarm version is a signed .xanima of Anima Minds
--    (MKT-03); a team package is workforce definitions and team functions and has no Soul.
-- 2. A `team` version carries its package (`team_package`) and the package's hash. PUBLISHING one --
--    at insert or when review sets `published_at` -- requires a licence and a package of exactly the
--    allowed shape: team name/description, and 1..64 agent members each holding only instructions,
--    skills, requested capabilities, secret NAMES (strings, never an object with a vault `ref`), a
--    team function, and a licence that is either absent (the version's licence governs: the seller is
--    the licensor of their own authored agent) or on the redistributable list. Anything else -- a human,
--    a principal id, a session, a Soul, a credential -- has nowhere to go, so a package carrying one is
--    refused, including when a reviewer approves it. A published package is immutable and retained.
-- 3. `marketplace_team_imports` is the provenance of every imported team: which listing, version,
--    package hash, licence and entitlement produced it, who imported it, into which owner scope, and
--    the NEW ids it became. It holds no seller team id -- the seller's team is not part of what was
--    sold. One import per (entitlement, version, owner): buying once and importing twice into the same
--    place returns the same instance.
--
-- REDISTRIBUTABLE means the licence's own terms permit passing the definition on: the permissive and
-- open SPDX identifiers below, or `LicenseRef-XENO-Marketplace-Redistributable`, which a seller sets
-- deliberately. Anything else is not, because nothing on record says it may be handed on -- unknown is
-- refused, never assumed (PUB-04: "without redistribution rights cannot be assumed reusable").

ALTER TABLE marketplace_listings DROP CONSTRAINT IF EXISTS marketplace_listings_kind_check;
ALTER TABLE marketplace_listings ADD CONSTRAINT marketplace_listings_kind_check
  CHECK (kind IN ('app-native','app-sandboxed','panel','plugin','mcp','model','mind','swarm','team'));

ALTER TABLE marketplace_listing_versions
  ADD COLUMN IF NOT EXISTS team_package JSONB,
  ADD COLUMN IF NOT EXISTS team_package_hash TEXT
    CHECK (team_package_hash IS NULL OR team_package_hash ~ '^[0-9a-f]{64}$');
COMMENT ON COLUMN marketplace_listing_versions.team_package IS
  'MKT-04/D22: the team package a `team` version sells, built by the platform from a canonical team. Immutable once published.';

CREATE OR REPLACE FUNCTION marketplace_licence_redistributable(identifier TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(identifier = ANY (ARRAY['Apache-2.0','MIT','BSD-2-Clause','BSD-3-Clause','ISC','MPL-2.0',
    'CC0-1.0','CC-BY-4.0','Unlicense','LicenseRef-XENO-Marketplace-Redistributable']), false)
$$;

CREATE OR REPLACE FUNCTION marketplace_team_package_valid(p JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE m JSONB; d JSONB; secret JSONB;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p->>'format' IS DISTINCT FROM 'xeno-team-package'
     OR p->'schemaVersion' IS DISTINCT FROM '1'::jsonb
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('format','schemaVersion','team','members'))
     OR jsonb_typeof(p->'team') IS DISTINCT FROM 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p->'team') k WHERE k NOT IN ('name','description'))
     OR jsonb_typeof(p->'team'->'name') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p->'members') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p->'members') NOT BETWEEN 1 AND 64 THEN
    RETURN false;
  END IF;
  FOR m IN SELECT * FROM jsonb_array_elements(p->'members') LOOP
    IF jsonb_typeof(m) IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(m) k WHERE k NOT IN ('key','name','role','license','definition'))
       OR m->>'role' IS NULL OR m->>'role' NOT IN ('manager','worker','observer')
       OR NOT (m->'license' IS NULL OR m->'license' = 'null'::jsonb OR marketplace_licence_redistributable(m->>'license')) THEN
      RETURN false;
    END IF;
    d := m->'definition';
    IF jsonb_typeof(d) IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(d) k WHERE k NOT IN ('instructions','skills','requestedCapabilities','secretNames'))
       OR jsonb_typeof(COALESCE(d->'secretNames', '[]'::jsonb)) IS DISTINCT FROM 'array' THEN
      RETURN false;
    END IF;
    -- A secret travels as its NAME. An object here would be a pointer into the seller's vault.
    FOR secret IN SELECT * FROM jsonb_array_elements(COALESCE(d->'secretNames', '[]'::jsonb)) LOOP
      IF jsonb_typeof(secret) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION marketplace_team_version_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE listing_kind TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.team_package IS NOT NULL AND OLD.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'a published team package is retained; publish a new version instead' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  SELECT kind INTO listing_kind FROM marketplace_listings WHERE id = NEW.listing_id;
  IF listing_kind IS DISTINCT FROM 'team' THEN
    IF NEW.team_package IS NOT NULL OR NEW.team_package_hash IS NOT NULL THEN
      RAISE EXCEPTION 'only a team listing carries a team package' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.published_at IS NOT NULL
     AND ROW(NEW.listing_id, NEW.version, NEW.team_package, NEW.team_package_hash, NEW.license, NEW.published_at, NEW.created_at)
         IS DISTINCT FROM
         ROW(OLD.listing_id, OLD.version, OLD.team_package, OLD.team_package_hash, OLD.license, OLD.published_at, OLD.created_at) THEN
    RAISE EXCEPTION 'a published team package is immutable; publish a new version instead' USING ERRCODE = '23514';
  END IF;
  IF NEW.published_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.published_at IS NULL) THEN
    IF NEW.license IS NULL OR btrim(NEW.license) = '' THEN
      RAISE EXCEPTION 'a team package is published under a licence' USING ERRCODE = '23514';
    END IF;
    IF NEW.team_package IS NULL OR NEW.team_package_hash IS NULL OR NOT marketplace_team_package_valid(NEW.team_package) THEN
      RAISE EXCEPTION 'a published team package holds only redistributable team configuration' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS marketplace_team_version_guard ON marketplace_listing_versions;
CREATE TRIGGER marketplace_team_version_guard
  BEFORE INSERT OR UPDATE OR DELETE ON marketplace_listing_versions
  FOR EACH ROW EXECUTE FUNCTION marketplace_team_version_guard();

CREATE TABLE IF NOT EXISTS marketplace_team_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL UNIQUE REFERENCES workforce_resources(id) ON DELETE RESTRICT,
  listing_id UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE RESTRICT,
  listing_version_id UUID NOT NULL REFERENCES marketplace_listing_versions(id) ON DELETE RESTRICT,
  package_hash TEXT NOT NULL CHECK (package_hash ~ '^[0-9a-f]{64}$'),
  license TEXT NOT NULL CHECK (length(btrim(license)) > 0),
  entitlement_id UUID NOT NULL REFERENCES marketplace_entitlements(id) ON DELETE RESTRICT,
  seller_developer_id UUID,
  imported_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('user','workspace')),
  owner_id UUID NOT NULL,
  member_agent_ids UUID[] NOT NULL,
  -- Per new agent id: the secret NAMES its definition declares, each unbound until the buyer binds one.
  required_secrets JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(required_secrets) = 'object'),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entitlement_id, listing_version_id, owner_type, owner_id)
);
COMMENT ON TABLE marketplace_team_imports IS
  'MKT-04: where an imported team came from. Carries no id of the seller''s team, which was never part of the sale.';

CREATE OR REPLACE FUNCTION marketplace_team_import_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Erasure of the importing account may clear attribution, and nothing else.
  IF TG_OP = 'UPDATE' AND NEW.imported_by_user_id IS NULL AND OLD.imported_by_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.imported_by_user_id)
     AND (to_jsonb(NEW) - 'imported_by_user_id') = (to_jsonb(OLD) - 'imported_by_user_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'team import provenance is retained and immutable' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS marketplace_team_imports_immutable ON marketplace_team_imports;
CREATE TRIGGER marketplace_team_imports_immutable BEFORE UPDATE OR DELETE ON marketplace_team_imports
  FOR EACH ROW EXECUTE FUNCTION marketplace_team_import_immutable();
DROP TRIGGER IF EXISTS marketplace_team_imports_no_truncate ON marketplace_team_imports;
CREATE TRIGGER marketplace_team_imports_no_truncate BEFORE TRUNCATE ON marketplace_team_imports
  FOR EACH STATEMENT EXECUTE FUNCTION marketplace_team_import_immutable();

-- DOWN
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM marketplace_team_imports)
     OR EXISTS (SELECT 1 FROM marketplace_listing_versions WHERE team_package IS NOT NULL)
     OR EXISTS (SELECT 1 FROM marketplace_listings WHERE kind = 'team') THEN
    RAISE EXCEPTION 'rollback refused: team listings, packages or imported teams exist' USING ERRCODE = '23514';
  END IF;
END $$;
DROP TABLE IF EXISTS marketplace_team_imports;
DROP FUNCTION IF EXISTS marketplace_team_import_immutable();
DROP TRIGGER IF EXISTS marketplace_team_version_guard ON marketplace_listing_versions;
DROP FUNCTION IF EXISTS marketplace_team_version_guard();
DROP FUNCTION IF EXISTS marketplace_team_package_valid(JSONB);
DROP FUNCTION IF EXISTS marketplace_licence_redistributable(TEXT);
ALTER TABLE marketplace_listing_versions DROP COLUMN IF EXISTS team_package_hash, DROP COLUMN IF EXISTS team_package;
ALTER TABLE marketplace_listings DROP CONSTRAINT IF EXISTS marketplace_listings_kind_check;
ALTER TABLE marketplace_listings ADD CONSTRAINT marketplace_listings_kind_check
  CHECK (kind IN ('app-native','app-sandboxed','panel','plugin','mcp','model','mind','swarm'));
