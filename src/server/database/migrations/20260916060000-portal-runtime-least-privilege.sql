-- Least privilege for xeno_portal_runtime on users (password-reset follow-up, task 4).
--
-- WHY
-- ---
-- The API console (xeno-api-platform/portal on xeno-private-api-001, connecting to
-- this database as xeno_portal_runtime) held table-wide UPDATE and INSERT on users.
-- Table-wide UPDATE lets it rewrite ANY column, including password_hash -- which is
-- the capability that made the 2026-09-15 out-of-band password reset possible, and
-- is exactly the thing that should not be reachable from a console.
--
-- Measured before revoking: the portal writes users in exactly two places, neither
-- touching credentials --
--   portal/lib/platform-billing.ts:362   UPDATE users SET preferences, updated_at
--   portal/lib/platform-billing.ts:4250  UPDATE users SET email, username, updated_at
-- and it has NO `INSERT INTO users` anywhere (the platform backend creates accounts;
-- it connects as `postgres`, not as this role).
--
-- Proven in both directions on production after applying:
--   preferences write            -> ALLOWED
--   email/username write         -> ALLOWED
--   password_hash write          -> ERROR: permission denied for table users
--   DELETE FROM user_sessions    -> ERROR: permission denied for table user_sessions
-- The portal was restarted afterwards and logged no permission errors.
--
-- NOTE ON user_sessions / password_resets: this role has NO grants on either, which
-- is why the 2026-09-15 reset could not revoke sessions or burn reset tokens (42501).
-- That is CORRECT and is deliberately left as-is. Session revocation belongs to the
-- platform backend's audited admin path (POST /api/auth/admin-reset-password), not
-- to a console with direct table access. Do not "fix" it by granting here.
--
-- Idempotent: REVOKE of an absent privilege and a repeated GRANT are both no-ops.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xeno_portal_runtime') THEN
    REVOKE UPDATE, INSERT ON users FROM xeno_portal_runtime;
    GRANT UPDATE (preferences, email, username, updated_at) ON users TO xeno_portal_runtime;
  END IF;
END
$$;
