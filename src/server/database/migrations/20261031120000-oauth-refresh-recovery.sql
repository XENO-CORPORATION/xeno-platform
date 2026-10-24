-- UP
-- Idempotent refresh recovery. A client that sent a refresh and was killed before persisting the
-- successor can retry the OLD token with the same rotation_id instead of tripping reuse detection
-- (and losing the whole family). successor_id = the row the rotation issued; rotation_id_hash =
-- sha256 of the client-chosen rotation_id (never the raw value). Both nullable and additive: rows
-- from before this column simply cannot be recovered, which is today's behaviour.
-- oauth_refresh_tokens is created by database/migrate-account-v2.js, which adds the same columns; this
-- file covers databases where that table already existed, and is a no-op where it does not yet.
DO $$
BEGIN
  IF to_regclass('public.oauth_refresh_tokens') IS NOT NULL THEN
    ALTER TABLE oauth_refresh_tokens ADD COLUMN IF NOT EXISTS successor_id uuid;
    ALTER TABLE oauth_refresh_tokens ADD COLUMN IF NOT EXISTS rotation_id_hash text;
  END IF;
END $$;

-- DOWN
DO $$
BEGIN
  IF to_regclass('public.oauth_refresh_tokens') IS NOT NULL THEN
    ALTER TABLE oauth_refresh_tokens DROP COLUMN IF EXISTS rotation_id_hash;
    ALTER TABLE oauth_refresh_tokens DROP COLUMN IF EXISTS successor_id;
  END IF;
END $$;
