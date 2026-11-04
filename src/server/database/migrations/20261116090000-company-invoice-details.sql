-- Where a business is paid, which goes on every invoice, and the limit it wants to watch as a small business (owner, 2026-11-04).
-- The limit is the business's own figure, because every country sets its own. Only adds: every existing row reads as before.
ALTER TABLE org_profiles ADD COLUMN IF NOT EXISTS payment_account TEXT CHECK (payment_account IS NULL OR length(btrim(payment_account)) BETWEEN 1 AND 34);
ALTER TABLE org_profiles ADD COLUMN IF NOT EXISTS payment_bic TEXT CHECK (payment_bic IS NULL OR length(payment_bic) IN (8, 11));
ALTER TABLE org_profiles ADD COLUMN IF NOT EXISTS payment_account_name TEXT CHECK (payment_account_name IS NULL OR length(btrim(payment_account_name)) BETWEEN 1 AND 200);
ALTER TABLE org_profiles ADD COLUMN IF NOT EXISTS revenue_limit_minor BIGINT CHECK (revenue_limit_minor IS NULL OR revenue_limit_minor > 0);
ALTER TABLE org_profiles ADD COLUMN IF NOT EXISTS revenue_limit_currency TEXT CHECK (revenue_limit_currency IS NULL OR revenue_limit_currency ~ '^[A-Z]{3}$');
ALTER TABLE org_profiles ADD CONSTRAINT org_profiles_limit_has_currency CHECK ((revenue_limit_minor IS NULL) = (revenue_limit_currency IS NULL));

-- DOWN
ALTER TABLE org_profiles DROP CONSTRAINT IF EXISTS org_profiles_limit_has_currency;
ALTER TABLE org_profiles DROP COLUMN IF EXISTS revenue_limit_currency;
ALTER TABLE org_profiles DROP COLUMN IF EXISTS revenue_limit_minor;
ALTER TABLE org_profiles DROP COLUMN IF EXISTS payment_account_name;
ALTER TABLE org_profiles DROP COLUMN IF EXISTS payment_bic;
ALTER TABLE org_profiles DROP COLUMN IF EXISTS payment_account;
