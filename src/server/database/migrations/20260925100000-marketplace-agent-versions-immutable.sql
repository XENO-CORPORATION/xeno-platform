-- UP
-- XENO-WORKFORCE-01 MKT-03: "Publish immutable licensed agent versions and coordinated-agent packages
-- through existing marketplace review/signing/distribution rails. Keep `mind`/legacy `swarm` listing
-- compatibility and canonical artifact naming. Do not change shipping trust roots to pass a gate."
--
-- The rails already exist -- listing versions, Ed25519 signatures over the artifact's SHA-256, the
-- submit -> automated checks -> admin review -> publish path, entitlement-gated R2 download. What they
-- did not do for an AGENT was hold still: a published version's artifact, hash, signature, manifest and
-- licence could all be rewritten in place, so "the version you bought" named nothing fixed, and nothing
-- required a licence or a signature on an agent at all. This adds exactly that, and nothing else:
--
-- 1. A version CARRIES ITS LICENCE (`license`), snapshotted when the version is created. The listing's
--    licence is a label that can change; what a buyer received is the licence of the version they got.
-- 2. A version of a `mind` or `swarm` listing is an AGENT PACKAGE (`agent_package`, derived at insert
--    from the listing -- never taken from the caller). `swarm` stays a listing kind: it is the legacy
--    name for a coordinated package, and the .xanima format calls the same thing a swarm-kind container.
-- 3. PUBLISHING an agent package -- at insert or when review sets `published_at` -- requires: a licence;
--    and, if it ships an artifact, a signed canonical `.xanima` whose declared manifest is a .xanima of
--    the listing's kind that does not embed a private Soul (Marketplace D3: the Soul never transfers).
--    This is the database's own invariant, so it holds for the reviewer too: an admin approving a
--    version that breaks it is refused, not trusted. The route answers the same rules earlier.
-- 4. A PUBLISHED agent package is IMMUTABLE and RETAINED: its identity, artifact, hash, signature,
--    manifest, declared capabilities and licence cannot change, and it cannot be deleted or truncated.
--    A change is a new version. Serving state (`servable`, `serving_material*`, MKT-05/07) is review
--    state about how the platform may run it, and stays outside the frozen set.
--
-- What this deliberately does NOT do: verify the signature (the route does, with verifyEd25519, against
-- the key the version declares) or add any key to any trust store. Existing rows are untouched except
-- the derived `agent_package` flag; nothing already published is re-checked.

ALTER TABLE marketplace_listing_versions
  ADD COLUMN IF NOT EXISTS license TEXT CHECK (license IS NULL OR length(license) <= 120),
  ADD COLUMN IF NOT EXISTS agent_package BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN marketplace_listing_versions.license IS
  'MKT-03: the licence this version was published under, snapshotted at creation.';
COMMENT ON COLUMN marketplace_listing_versions.agent_package IS
  'MKT-03: a version of a mind/swarm listing. Derived at insert; immutable.';

UPDATE marketplace_listing_versions v SET agent_package = true
  FROM marketplace_listings l
 WHERE l.id = v.listing_id AND l.kind IN ('mind', 'swarm') AND NOT v.agent_package;

CREATE OR REPLACE FUNCTION marketplace_agent_version_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE listing_kind TEXT; location TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.agent_package AND OLD.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'a published agent version is retained; publish a new version instead' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  SELECT kind INTO listing_kind FROM marketplace_listings WHERE id = NEW.listing_id;
  IF TG_OP = 'INSERT' THEN
    NEW.agent_package := COALESCE(listing_kind IN ('mind', 'swarm'), false);
  ELSE
    IF NEW.agent_package IS DISTINCT FROM OLD.agent_package THEN
      RAISE EXCEPTION 'agent_package is derived and immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.agent_package AND OLD.published_at IS NOT NULL
       AND ROW(NEW.id, NEW.listing_id, NEW.version, NEW.artifact_r2_key, NEW.artifact_url, NEW.artifact_sha256,
               NEW.artifact_size_bytes, NEW.ed25519_sig, NEW.ed25519_pubkey, NEW.manifest, NEW.declared_capabilities,
               NEW.has_native_binary, NEW.license, NEW.published_at, NEW.created_at)
           IS DISTINCT FROM
           ROW(OLD.id, OLD.listing_id, OLD.version, OLD.artifact_r2_key, OLD.artifact_url, OLD.artifact_sha256,
               OLD.artifact_size_bytes, OLD.ed25519_sig, OLD.ed25519_pubkey, OLD.manifest, OLD.declared_capabilities,
               OLD.has_native_binary, OLD.license, OLD.published_at, OLD.created_at) THEN
      RAISE EXCEPTION 'a published agent version is immutable; publish a new version instead' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.agent_package AND NEW.published_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.published_at IS NULL) THEN
    IF NEW.license IS NULL OR btrim(NEW.license) = '' THEN
      RAISE EXCEPTION 'an agent version is published under a licence' USING ERRCODE = '23514';
    END IF;
    IF NEW.artifact_r2_key IS NOT NULL OR NEW.artifact_url IS NOT NULL THEN
      IF NEW.artifact_sha256 IS NULL OR NEW.artifact_sha256 !~* '^[0-9a-f]{64}$'
         OR btrim(COALESCE(NEW.ed25519_sig, '')) = '' OR btrim(COALESCE(NEW.ed25519_pubkey, '')) = '' THEN
        RAISE EXCEPTION 'a published agent artifact is signed' USING ERRCODE = '23514';
      END IF;
      FOREACH location IN ARRAY ARRAY[NEW.artifact_r2_key, split_part(NEW.artifact_url, '?', 1)] LOOP
        IF location IS NOT NULL AND lower(location) NOT LIKE '%.xanima' THEN
          RAISE EXCEPTION 'a published agent artifact is a canonical .xanima' USING ERRCODE = '23514';
        END IF;
      END LOOP;
      IF NEW.manifest->>'format' IS DISTINCT FROM 'xanima'
         OR NEW.manifest->>'kind' IS DISTINCT FROM (CASE listing_kind WHEN 'swarm' THEN 'swarm' ELSE 'anima' END) THEN
        RAISE EXCEPTION 'a published agent manifest is a .xanima of the listing''s kind' USING ERRCODE = '23514';
      END IF;
      IF jsonb_path_exists(NEW.manifest, '$.minds[*].soul.embedded ? (@ == true)') THEN
        RAISE EXCEPTION 'a published agent package never carries a private Soul' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION marketplace_agent_version_no_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM marketplace_listing_versions WHERE agent_package AND published_at IS NOT NULL) THEN
    RAISE EXCEPTION 'published agent versions are retained' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS marketplace_agent_version_guard ON marketplace_listing_versions;
CREATE TRIGGER marketplace_agent_version_guard
  BEFORE INSERT OR UPDATE OR DELETE ON marketplace_listing_versions
  FOR EACH ROW EXECUTE FUNCTION marketplace_agent_version_guard();
DROP TRIGGER IF EXISTS marketplace_agent_version_no_truncate ON marketplace_listing_versions;
CREATE TRIGGER marketplace_agent_version_no_truncate
  BEFORE TRUNCATE ON marketplace_listing_versions
  FOR EACH STATEMENT EXECUTE FUNCTION marketplace_agent_version_no_truncate();

-- DOWN
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM marketplace_listing_versions WHERE license IS NOT NULL) THEN
    RAISE EXCEPTION 'rollback refused: versions carry published licences that would be lost' USING ERRCODE = '23514';
  END IF;
END $$;
DROP TRIGGER IF EXISTS marketplace_agent_version_no_truncate ON marketplace_listing_versions;
DROP TRIGGER IF EXISTS marketplace_agent_version_guard ON marketplace_listing_versions;
DROP FUNCTION IF EXISTS marketplace_agent_version_no_truncate();
DROP FUNCTION IF EXISTS marketplace_agent_version_guard();
ALTER TABLE marketplace_listing_versions DROP COLUMN IF EXISTS agent_package, DROP COLUMN IF EXISTS license;
