-- UP
-- A customer company in Corpo › Customers carries the details an invoice needs (who is billed, their tax number,
-- their address), so Corpo › Company's New invoice can pick the customer instead of retyping it. The shape is
-- checked by services/customers.js; the database only bounds its size. Additive and nullable: no existing row changes.
ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS billing JSONB;
ALTER TABLE crm_companies DROP CONSTRAINT IF EXISTS crm_companies_billing_bounded;
ALTER TABLE crm_companies ADD CONSTRAINT crm_companies_billing_bounded
  CHECK (billing IS NULL OR (jsonb_typeof(billing) = 'object' AND length(billing::text) <= 4000));

-- DOWN
ALTER TABLE crm_companies DROP CONSTRAINT IF EXISTS crm_companies_billing_bounded;
ALTER TABLE crm_companies DROP COLUMN IF EXISTS billing;
