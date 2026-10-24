-- UP
-- A skill holds as many files as XENO Corpus allows a bundle (MAX_BUNDLE_FILES = 500, corpus-skills.mjs), so a skill a
-- person keeps in Claude Code, Codex or their Corpus is never refused here for size alone (64 refused 3 real skills,
-- measured 2026-10-24). The byte limit is the service's (services/skills.js), not the database's. Widening only.

ALTER TABLE skill_versions DROP CONSTRAINT IF EXISTS skill_versions_files_check;
ALTER TABLE skill_versions ADD CONSTRAINT skill_versions_files_check
  CHECK (jsonb_typeof(files) = 'array' AND jsonb_array_length(files) BETWEEN 1 AND 500);

CREATE OR REPLACE FUNCTION marketplace_skill_package_valid(p JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE f JSONB; i INT := 0;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p->>'format' IS DISTINCT FROM 'xeno-skill-package'
     OR p->'schemaVersion' IS DISTINCT FROM '1'::jsonb
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('format','schemaVersion','name','description','files'))
     OR jsonb_typeof(p->'name') IS DISTINCT FROM 'string' OR (p->>'name') !~ '^[a-z0-9][a-z0-9-]{0,63}$'
     OR jsonb_typeof(p->'description') IS DISTINCT FROM 'string' OR char_length(p->>'description') NOT BETWEEN 1 AND 1024
     OR jsonb_typeof(p->'files') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'files') NOT BETWEEN 1 AND 500 THEN
    RETURN false;
  END IF;
  FOR f IN SELECT * FROM jsonb_array_elements(p->'files') LOOP
    IF jsonb_typeof(f) IS DISTINCT FROM 'object' OR jsonb_typeof(f->'path') IS DISTINCT FROM 'string'
       OR (f->>'path') ~ '(^/|\.\.|\\)' OR (i = 0 AND f->>'path' IS DISTINCT FROM 'SKILL.md') THEN
      RETURN false;
    END IF;
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
-- refuse rather than break rows: a version with more than 64 files cannot go back under the old limit
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM skill_versions WHERE jsonb_array_length(files) > 64) THEN
    RAISE EXCEPTION 'skill versions with more than 64 files exist; undoing this would break them' USING ERRCODE = '23514';
  END IF;
END $$;
ALTER TABLE skill_versions DROP CONSTRAINT IF EXISTS skill_versions_files_check;
ALTER TABLE skill_versions ADD CONSTRAINT skill_versions_files_check
  CHECK (jsonb_typeof(files) = 'array' AND jsonb_array_length(files) BETWEEN 1 AND 64);
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
