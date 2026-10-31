-- UP
-- The staged OIDC issuer move (docs/decisions/2026-10-28-oidc-issuer-staged-move.md): each refresh token records
-- which provider issued it, so a back-channel logout names the issuer that client knows. Nullable and additive: a
-- row from before this column means today's issuer, which is what every existing row was issued under.
-- oauth_refresh_tokens is created by database/migrate-account-v2.js, which adds the same column; this file covers
-- databases where that table already existed, and is a no-op where it does not yet.
DO $$
BEGIN
  IF to_regclass('public.oauth_refresh_tokens') IS NOT NULL THEN
    ALTER TABLE oauth_refresh_tokens ADD COLUMN IF NOT EXISTS issuer text;
  END IF;
END $$;

-- DOWN
DO $$
BEGIN
  IF to_regclass('public.oauth_refresh_tokens') IS NOT NULL THEN
    ALTER TABLE oauth_refresh_tokens DROP COLUMN IF EXISTS issuer;
  END IF;
END $$;
