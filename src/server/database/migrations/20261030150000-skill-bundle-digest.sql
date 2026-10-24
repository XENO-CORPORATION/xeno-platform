-- UP
-- XENO Corpus's bundle digest beside the platform's skill hash (docs/AGENT-IDENTITY-SKILLS-CORPUS.md §7 4a; agreed with the
-- XENO - Corpus session 2026-10-24). EXPAND step of expand/contract:
--   1. skill_versions.bundle_digest -- "sha256:" + SHA-256 over the sorted "<path> sha256:<file hex>" lines, computed by
--      Corpus's own vendored code (src/server/vendor/xeno-corpus/corpus-skill-format.mjs), never by SQL;
--   2. a version stays immutable, with exactly one exception: the digest may be filled ONCE, from empty, so existing
--      versions can be backfilled by services/skills.js backfillBundleDigests at startup. Changing or clearing it is
--      refused like any other change.
-- The content_hash stays until no pin reads it (the contract step). Additive only; the undo section removes exactly this.

ALTER TABLE skill_versions
  ADD COLUMN IF NOT EXISTS bundle_digest TEXT NULL CHECK (bundle_digest IS NULL OR bundle_digest ~ '^sha256:[0-9a-f]{64}$');

CREATE OR REPLACE FUNCTION skill_versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.bundle_digest IS NULL AND NEW.bundle_digest IS NOT NULL
     AND (to_jsonb(NEW) - 'bundle_digest') = (to_jsonb(OLD) - 'bundle_digest') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'a skill version never changes; publish a new version instead' USING ERRCODE = '23514';
END $$;

-- DOWN
CREATE OR REPLACE FUNCTION skill_versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'a skill version never changes; publish a new version instead' USING ERRCODE = '23514';
END $$;
ALTER TABLE skill_versions DROP COLUMN IF EXISTS bundle_digest;
