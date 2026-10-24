-- UP
-- Skills on the XENO Marketplace (docs/AGENT-IDENTITY-SKILLS-CORPUS.md D3; /isg 2026-10-24). One global catalog, the same
-- Marketplace that sells apps, agents and teams; a skill is listing kind `skill`.
--
-- 1. A `skill` version carries the skill package the PLATFORM built from one skill version in the seller's library
--    (services/marketplaceSkillPackages.js) and its hash -- never a caller-supplied package. The hash is the same
--    SHA-256 the library and an agent pin use, so "this exact version" means the same bytes everywhere.
-- 2. PUBLISHING one -- at insert or when review sets published_at -- requires a licence and a package of exactly the
--    allowed shape: format, schema, name, description and 1..64 text files with SKILL.md first. A published package
--    is immutable and retained, including against a reviewer.
-- 3. skills.origin_* records where a library skill came from (a Marketplace listing and version), so its owner is
--    told when a newer version is published -- and nothing updates until they install it.
-- Additive only. The undo section removes exactly what this adds.

ALTER TABLE marketplace_listings DROP CONSTRAINT IF EXISTS marketplace_listings_kind_check;
ALTER TABLE marketplace_listings ADD CONSTRAINT marketplace_listings_kind_check
  CHECK (kind IN ('app-native','app-sandboxed','panel','plugin','mcp','model','mind','swarm','team','mode','skill'));

ALTER TABLE marketplace_listing_versions
  ADD COLUMN IF NOT EXISTS skill_package JSONB,
  ADD COLUMN IF NOT EXISTS skill_package_hash TEXT CHECK (skill_package_hash IS NULL OR skill_package_hash ~ '^[0-9a-f]{64}$');

CREATE OR REPLACE FUNCTION marketplace_skill_package_valid(p JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE f JSONB; i INT := 0;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p->>'format' IS DISTINCT FROM 'xeno-skill-package'
     OR p->'schemaVersion' IS DISTINCT FROM '1'::jsonb
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('format','schemaVersion','name','description','files'))
     OR jsonb_typeof(p->'name') IS DISTINCT FROM 'string' OR (p->>'name') !~ '^[a-z0-9][a-z0-9-]{0,63}$'
     OR jsonb_typeof(p->'description') IS DISTINCT FROM 'string' OR char_length(p->>'description') NOT BETWEEN 1 AND 1024
     OR jsonb_typeof(p->'files') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'files') NOT BETWEEN 1 AND 64 THEN
    RETURN false;
  END IF;
  FOR f IN SELECT * FROM jsonb_array_elements(p->'files') LOOP
    IF jsonb_typeof(f) IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(f) k WHERE k NOT IN ('path','content'))
       OR jsonb_typeof(f->'path') IS DISTINCT FROM 'string' OR jsonb_typeof(f->'content') IS DISTINCT FROM 'string'
       OR (f->>'path') ~ '(^/|\.\.|\\)' OR (i = 0 AND f->>'path' IS DISTINCT FROM 'SKILL.md') THEN
      RETURN false;
    END IF;
    i := i + 1;
  END LOOP;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION marketplace_skill_version_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE listing_kind TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.skill_package IS NOT NULL AND OLD.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'a published skill package is retained; publish a new version instead' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  SELECT kind INTO listing_kind FROM marketplace_listings WHERE id = NEW.listing_id;
  IF listing_kind IS DISTINCT FROM 'skill' THEN
    IF NEW.skill_package IS NOT NULL OR NEW.skill_package_hash IS NOT NULL THEN
      RAISE EXCEPTION 'only a skill listing carries a skill package' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.published_at IS NOT NULL
     AND ROW(NEW.listing_id, NEW.version, NEW.skill_package, NEW.skill_package_hash, NEW.license, NEW.published_at, NEW.created_at)
         IS DISTINCT FROM
         ROW(OLD.listing_id, OLD.version, OLD.skill_package, OLD.skill_package_hash, OLD.license, OLD.published_at, OLD.created_at) THEN
    RAISE EXCEPTION 'a published skill package is immutable; publish a new version instead' USING ERRCODE = '23514';
  END IF;
  IF NEW.published_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.published_at IS NULL) THEN
    IF NEW.license IS NULL OR btrim(NEW.license) = '' THEN
      RAISE EXCEPTION 'a skill package is published under a licence' USING ERRCODE = '23514';
    END IF;
    IF NEW.skill_package IS NULL OR NEW.skill_package_hash IS NULL OR NOT marketplace_skill_package_valid(NEW.skill_package) THEN
      RAISE EXCEPTION 'a published skill package is a SKILL.md and its text files, nothing else' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS marketplace_skill_version_guard ON marketplace_listing_versions;
CREATE TRIGGER marketplace_skill_version_guard
  BEFORE INSERT OR UPDATE OR DELETE ON marketplace_listing_versions
  FOR EACH ROW EXECUTE FUNCTION marketplace_skill_version_guard();

-- where a library skill came from: a Marketplace listing, at the version installed last
ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS origin_listing_id UUID NULL REFERENCES marketplace_listings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origin_version TEXT NULL;

-- DOWN
ALTER TABLE skills DROP COLUMN IF EXISTS origin_version;
ALTER TABLE skills DROP COLUMN IF EXISTS origin_listing_id;
DROP TRIGGER IF EXISTS marketplace_skill_version_guard ON marketplace_listing_versions;
DROP FUNCTION IF EXISTS marketplace_skill_version_guard();
DROP FUNCTION IF EXISTS marketplace_skill_package_valid(JSONB);
ALTER TABLE marketplace_listing_versions DROP COLUMN IF EXISTS skill_package_hash;
ALTER TABLE marketplace_listing_versions DROP COLUMN IF EXISTS skill_package;
ALTER TABLE marketplace_listings DROP CONSTRAINT IF EXISTS marketplace_listings_kind_check;
ALTER TABLE marketplace_listings ADD CONSTRAINT marketplace_listings_kind_check
  CHECK (kind IN ('app-native','app-sandboxed','panel','plugin','mcp','model','mind','swarm','team','mode'));
