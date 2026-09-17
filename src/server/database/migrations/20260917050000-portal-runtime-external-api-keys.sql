-- xeno_portal_runtime: the grants on external_api_keys the API console has needed
-- since April and never had.
--
-- WHY
-- ---
-- The portal's key list (portal/lib/platform-billing.ts ~3801) LEFT JOINs
-- external_api_keys, and its key-issue / key-revoke paths INSERT into it and
-- UPDATE legacy_status. That JOIN dates from 2026-04-08 (cd0abcb). The role had
-- NO privilege on the table, so GET /api/keys answered 500 and the operator saw
-- "0 keys" while holding 25.
--
-- This surfaced on 2026-09-16, and the .224 session attributed it to that day's
-- least-privilege narrowing (20260916060000). That migration touched `users`
-- only — zero references to this table. The likely trigger was the portal
-- RESTART performed alongside it: the process re-read its .env and began
-- connecting as xeno_portal_runtime, exposing a gap that had been latent under
-- whatever role the long-running process had been launched with. A supervisor's
-- view of a process is a fact about its launch, not the process.
--
-- WHAT
-- ----
-- Exactly what the code issues, measured 2026-09-17:
--   SELECT                                (the JOIN)
--   INSERT                                (createCanonicalApiKeyForLocalUser)
--   UPDATE (legacy_status, updated_at)    (revoke path, ~4103)
-- No DELETE — none is issued. The table holds no secret material (spec §2.1:
-- key_prefix, external_key_id, counters; it is the gateway<->platform key
-- reconciliation map, not a vault).
--
-- Proven on production before this file was written: the portal's join runs as
-- the role (43 rows); UPDATE of a column outside the grant and DELETE both
-- answer "permission denied"; GET /api/keys answers 401 unauthenticated, not 500.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xeno_portal_runtime') THEN
    GRANT SELECT, INSERT ON external_api_keys TO xeno_portal_runtime;
    GRANT UPDATE (legacy_status, updated_at) ON external_api_keys TO xeno_portal_runtime;
  END IF;
END
$$;
