-- email_opt_outs — the unsubscribe list.
--
-- Keyed by EMAIL, not user_id, on purpose:
--   * an unsubscribe must survive account deletion (otherwise deleting and
--     recreating an account silently re-subscribes someone who said no, which is
--     exactly what the law is about);
--   * a recipient can unsubscribe from a link without being signed in, and we must
--     honour it without resolving them to a user first;
--   * the same address may appear on more than one account over time.
--
-- Stored lowercased and trimmed — see normalizeEmail() in services/emailPreferences.js.
-- The two must agree; a lookup that misses because of casing is an unsubscribe that
-- did not work.
--
-- This is a NEW table rather than a column on `users`, per the rule in
-- `XENO IDENTITY - Migration & Versioning Plan` §3/R3: do not touch a live table's
-- columns. `users` has 221 rows and 33 inbound foreign keys.
CREATE TABLE IF NOT EXISTS email_opt_outs (
  email       text PRIMARY KEY,
  reason      text,
  -- The email CATEGORY opted out of. NULL = all non-essential mail.
  -- Security/transactional mail (password_reset, email_verification) is never
  -- suppressed by this table — see ESSENTIAL_TEMPLATES in services/emailService.js.
  category    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_opt_outs_created ON email_opt_outs (created_at DESC);
