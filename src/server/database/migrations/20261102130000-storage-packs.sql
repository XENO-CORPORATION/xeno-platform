-- UP
-- XENO Storage: buyable monthly extra space (owner, 2026-10-27: "+100 GB €1.99/mo and +2 TB €9.99/mo", the Google One
-- prices). A pack is a Stripe subscription; while it is paid it is a row in storage_grants, which the meter already adds
-- to the plan (storageAllowance.js). One grant per subscription: renewals and failures update it, a cancelled or
-- unpaid subscription revokes it. Revoking never deletes anything; over the allowance, new files are refused.
-- Additive: two nullable columns and a partial unique index.
ALTER TABLE storage_grants ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
ALTER TABLE storage_grants ADD COLUMN IF NOT EXISTS item_id text;
CREATE UNIQUE INDEX IF NOT EXISTS storage_grants_subscription ON storage_grants (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
-- DOWN
DROP INDEX IF EXISTS storage_grants_subscription;
ALTER TABLE storage_grants DROP COLUMN IF EXISTS item_id;
ALTER TABLE storage_grants DROP COLUMN IF EXISTS stripe_subscription_id;
