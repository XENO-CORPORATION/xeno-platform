-- UP
-- Where a device sign-in was STARTED (RFC 8628 §5.4, owner 2026-10-23). The approval page shows it
-- and warns when it differs from the browser approving it — the tell of a relayed (phished) code,
-- the attack used against Microsoft's device flow in 2025. Two letters from Cloudflare's
-- CF-IPCountry only; no IP is stored. Rows from before this column simply show no origin.
-- oauth_device_codes is created by database/migrate-account-v2.js, which adds the same column; this
-- file covers databases where that table already existed, and is a no-op where it does not yet.
DO $$
BEGIN
  IF to_regclass('public.oauth_device_codes') IS NOT NULL THEN
    ALTER TABLE oauth_device_codes
      ADD COLUMN IF NOT EXISTS request_country CHAR(2) CHECK (request_country IS NULL OR request_country ~ '^[A-Z]{2}$');
  END IF;
END $$;

-- DOWN
DO $$
BEGIN
  IF to_regclass('public.oauth_device_codes') IS NOT NULL THEN
    ALTER TABLE oauth_device_codes DROP COLUMN IF EXISTS request_country;
  END IF;
END $$;
