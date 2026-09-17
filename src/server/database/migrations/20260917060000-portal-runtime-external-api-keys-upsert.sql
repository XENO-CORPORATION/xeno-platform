-- xeno_portal_runtime: the UPDATE columns its external_api_keys UPSERT names.
--
-- 20260917050000 granted UPDATE (legacy_status, updated_at) — the columns the
-- revoke path SETs — and that was read off the wrong statement. The key-issue
-- path (platform-billing.ts ~4006) is an INSERT ... ON CONFLICT DO UPDATE SET
-- over nine columns, and PostgreSQL requires UPDATE privilege on every column
-- named in that SET list AT PLAN TIME, whether or not a conflict occurs. So the
-- INSERT itself was refused: the list page rendered, and creating a key answered
-- 500 "permission denied for table external_api_keys" on the next click — the
-- exact "fixed on the second click" I had said we would not ship. Own miss.
--
-- The set below is the SET list of that statement, measured from source, and it
-- is a superset of the revoke path's. No DELETE — none is issued. Proven on
-- production before this file: the real upsert shape plans and runs as the role
-- (rolled back, zero rows leaked); UPDATE of a column outside the set and
-- DELETE both answer "permission denied".
--
-- Lesson worth keeping: when granting for a statement, read the WHOLE statement.
-- An upsert's privilege footprint is its conflict clause, not its INSERT list.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xeno_portal_runtime') THEN
    GRANT UPDATE (
      platform_api_key_id, platform_project_id, external_user_id, external_email,
      key_prefix, legacy_status, legacy_created_at, metadata, updated_at
    ) ON external_api_keys TO xeno_portal_runtime;
  END IF;
END
$$;
