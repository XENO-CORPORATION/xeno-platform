-- UP
-- Land is billed to the WORKSPACE (owner 2026-10-21; WORKFORCE-01 §8.11: the workspace owns and bills its place).
-- billed_account_id = the credits_accounts row charged (a company workspace's own wallet; a personal workspace bills
-- its owner). payer_user_id stays and now means the ACCOUNTABLE person who leased it. Additive: one nullable column,
-- backfilled from the person who paid until now. DOWN drops it.
ALTER TABLE place_city_leases ADD COLUMN IF NOT EXISTS billed_account_id UUID;
UPDATE place_city_leases SET billed_account_id = payer_user_id WHERE billed_account_id IS NULL;

-- DOWN
ALTER TABLE place_city_leases DROP COLUMN IF EXISTS billed_account_id;
