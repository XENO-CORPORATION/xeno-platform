-- UP
-- Skill files keep their exact bytes (XENO Corpus D239, agreed with the XENO - Corpus session 2026-10-24).
-- A text file stays inline in skill_versions.files as { path, content } — UTF-8, byte-for-byte what was uploaded,
-- BOM and line endings kept. Any other file (an image, a font) is { path, sha256, bytes } in that list, and its bytes
-- live ONCE here, named by their own SHA-256 in Corpus's "sha256:<hex>" form — the same name Corpus's `.objects/<hex>`
-- gives them, so a bundle round-trips with Corpus and both compute the same bundle digest.
--   * an object is written once and never changed or deleted (a version names it, and versions never change);
--   * the service computes the digest from the bytes itself; a client never names it;
--   * a reader reaches an object only through a version it can read — this table is never listed or queried by hash
--     on behalf of a person.
-- Also: skills.source (where a skill came from: Corpus, GitHub), and the Marketplace package check allows the same
-- binary entry shape. Additive only; the undo section removes exactly this.

CREATE TABLE IF NOT EXISTS skill_objects (
  sha256 text PRIMARY KEY CHECK (sha256 ~ '^sha256:[0-9a-f]{64}$'),
  bytes bytea NOT NULL,
  size integer NOT NULL CHECK (size >= 0 AND size = octet_length(bytes)),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- the name IS the content: Postgres checks it too, so no code path can store bytes under another name
  CHECK (sha256 = 'sha256:' || encode(sha256(bytes), 'hex'))
);

CREATE OR REPLACE FUNCTION skill_objects_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'a skill file''s bytes never change; a different file is a different object' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS skill_objects_no_update ON skill_objects;
CREATE TRIGGER skill_objects_no_update BEFORE UPDATE ON skill_objects FOR EACH ROW EXECUTE FUNCTION skill_objects_immutable();
DROP TRIGGER IF EXISTS skill_objects_no_delete ON skill_objects;
CREATE TRIGGER skill_objects_no_delete BEFORE DELETE ON skill_objects FOR EACH ROW EXECUTE FUNCTION skill_objects_immutable();

-- Corpus's secret gate (D236): what a person should read, kept with the version it was found in — { review: [{ file,
-- line, rule }], reviewCount }, rule names and places only, never a value. Block-level material is never saved at all.
ALTER TABLE skill_versions ADD COLUMN IF NOT EXISTS review jsonb NULL CHECK (review IS NULL OR jsonb_typeof(review) = 'object');

-- { "kind": "corpus", "name": "...", "bundleDigest": "sha256:..." } | { "kind": "github", "url": "..." }
ALTER TABLE skills ADD COLUMN IF NOT EXISTS source jsonb NULL CHECK (source IS NULL OR jsonb_typeof(source) = 'object');

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
    IF jsonb_typeof(f) IS DISTINCT FROM 'object' OR jsonb_typeof(f->'path') IS DISTINCT FROM 'string'
       OR (f->>'path') ~ '(^/|\.\.|\\)' OR (i = 0 AND f->>'path' IS DISTINCT FROM 'SKILL.md') THEN
      RETURN false;
    END IF;
    -- a text file { path, content }, or (never SKILL.md) a binary file { path, sha256, bytes } whose bytes are stored
    IF NOT (
      (NOT EXISTS (SELECT 1 FROM jsonb_object_keys(f) k WHERE k NOT IN ('path','content')) AND jsonb_typeof(f->'content') = 'string')
      OR (i > 0 AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(f) k WHERE k NOT IN ('path','sha256','bytes'))
          AND jsonb_typeof(f->'sha256') = 'string' AND (f->>'sha256') ~ '^sha256:[0-9a-f]{64}$' AND jsonb_typeof(f->'bytes') = 'number')
    ) THEN
      RETURN false;
    END IF;
    i := i + 1;
  END LOOP;
  RETURN true;
END;
$$;

-- DOWN
-- refuse rather than lose bytes: once a version names a stored object, undoing this would leave it pointing at nothing
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM skill_objects) THEN
    RAISE EXCEPTION 'skill_objects holds files that skill versions name; undoing this would lose them' USING ERRCODE = '23514';
  END IF;
END $$;
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
ALTER TABLE skills DROP COLUMN IF EXISTS source;
ALTER TABLE skill_versions DROP COLUMN IF EXISTS review;
DROP TRIGGER IF EXISTS skill_objects_no_delete ON skill_objects;
DROP TRIGGER IF EXISTS skill_objects_no_update ON skill_objects;
DROP FUNCTION IF EXISTS skill_objects_immutable();
DROP TABLE IF EXISTS skill_objects;
