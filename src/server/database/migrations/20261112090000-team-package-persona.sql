-- UP
-- A team package now carries each member's persona (WHO the agent is: an Anima Mind body), beside its
-- definition, the same shape a single agent listing (kind `mind`) carries at its top level.
-- Before this, buildPackage left the persona out, so a buyer's copy lost the agent's identity and kept
-- only its instructions.
--
-- Additive: the allowlist accepts a superset. A package written before this has no `persona` key and stays
-- valid, so no published version changes and no stored hash moves.
CREATE OR REPLACE FUNCTION marketplace_team_package_valid(p JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE m JSONB; d JSONB; secret JSONB; persona JSONB;
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
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(m) k WHERE k NOT IN ('key','name','role','license','persona','definition'))
       OR m->>'role' IS NULL OR m->>'role' NOT IN ('manager','worker','observer')
       OR NOT (m->'license' IS NULL OR m->'license' = 'null'::jsonb OR marketplace_licence_redistributable(m->>'license')) THEN
      RETURN false;
    END IF;
    -- A persona is a role and a body, both text, or nothing. No other field rides along inside it.
    persona := m->'persona';
    IF NOT (persona IS NULL OR jsonb_typeof(persona) = 'null'
            OR (jsonb_typeof(persona) = 'object'
                AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(persona) k WHERE k NOT IN ('role','body'))
                AND jsonb_typeof(COALESCE(persona->'role', '""'::jsonb)) = 'string'
                AND jsonb_typeof(COALESCE(persona->'body', '""'::jsonb)) = 'string')) THEN
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

-- DOWN
-- The old allowlist refuses a `persona` key, so going back is refused while any stored package carries one.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM marketplace_listing_versions v, jsonb_array_elements(v.team_package->'members') m
             WHERE v.team_package IS NOT NULL AND m ? 'persona') THEN
    RAISE EXCEPTION 'rollback refused: team packages carrying a persona exist' USING ERRCODE = '23514';
  END IF;
END $$;
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
    FOR secret IN SELECT * FROM jsonb_array_elements(COALESCE(d->'secretNames', '[]'::jsonb)) LOOP
      IF jsonb_typeof(secret) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  RETURN true;
END;
$$;
