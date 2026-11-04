-- A business can be one person: a PFA, a Kleingewerbe, a sole trader. And it can be a small business that charges no VAT, which
-- is stated once here and carried onto every invoice (owner, 2026-11-04). Only adds: every existing row reads as before.
ALTER TABLE org_profiles ADD COLUMN IF NOT EXISTS entity_kind TEXT NOT NULL DEFAULT 'company' CHECK (entity_kind IN ('company', 'sole_proprietor'));
ALTER TABLE org_profiles ADD COLUMN IF NOT EXISTS tax_status TEXT NOT NULL DEFAULT 'standard' CHECK (tax_status IN ('standard', 'small_business'));
ALTER TABLE org_profiles ADD COLUMN IF NOT EXISTS tax_status_note TEXT CHECK (tax_status_note IS NULL OR length(btrim(tax_status_note)) BETWEEN 1 AND 300);
ALTER TABLE org_profiles ADD CONSTRAINT org_profiles_small_business_says_why CHECK (tax_status <> 'small_business' OR tax_status_note IS NOT NULL);

-- DOWN
ALTER TABLE org_profiles DROP CONSTRAINT IF EXISTS org_profiles_small_business_says_why;
ALTER TABLE org_profiles DROP COLUMN IF EXISTS tax_status_note;
ALTER TABLE org_profiles DROP COLUMN IF EXISTS tax_status;
ALTER TABLE org_profiles DROP COLUMN IF EXISTS entity_kind;
