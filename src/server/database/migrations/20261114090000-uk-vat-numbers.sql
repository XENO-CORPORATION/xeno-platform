-- A UK company can record its own VAT number. The original check refused every GB prefix because GB left VIES, which holds
-- for an EU check and not for what a UK company is registered under (owner, 2026-11-04: a company can be in any country).
-- Only loosens: every row that passed the old check passes this one.
DO $$
DECLARE c TEXT;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'org_tax_identifiers'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%GB%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE org_tax_identifiers DROP CONSTRAINT %I', c); END IF;
END $$;
ALTER TABLE org_tax_identifiers ADD CONSTRAINT org_tax_identifiers_vat_shape
  CHECK (scheme <> 'vat' OR (prefix IS NOT NULL AND prefix <> 'GR' AND (prefix <> 'GB' OR jurisdiction LIKE 'GB%') AND number ~ '^[0-9A-Za-z+*.]{2,12}$'));
