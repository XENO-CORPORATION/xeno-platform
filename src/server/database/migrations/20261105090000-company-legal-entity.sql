-- XENO Company's legal-entity layer (xeno-company/SPEC.md §4.2), keyed to workspaces: a company IS a workspace.
-- New tables only. Identifiers live in separate namespaces and none is computed from another (rule 1). A registration
-- is 1..N (rule 2). An EUID or a national number is stored and indexed, never a key (rules 3, 4).
CREATE TABLE IF NOT EXISTS org_profiles (
  workspace_id           UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  legal_name             TEXT CHECK (legal_name IS NULL OR length(btrim(legal_name)) BETWEEN 1 AND 300),
  legal_form             TEXT CHECK (legal_form IS NULL OR length(btrim(legal_form)) BETWEEN 1 AND 120),   -- rule 11: a pair
  governing_regime       TEXT CHECK (governing_regime IS NULL OR length(btrim(governing_regime)) BETWEEN 1 AND 120),
  registered_office      JSONB CHECK (registered_office IS NULL OR jsonb_typeof(registered_office) = 'object'),   -- rule 12: not one address
  central_administration JSONB CHECK (central_administration IS NULL OR jsonb_typeof(central_administration) = 'object'),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS org_registrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  jurisdiction    TEXT NOT NULL CHECK (jurisdiction ~ '^[A-Z]{2}(-[A-Z0-9]{1,6})?$'),
  register_name   TEXT NOT NULL CHECK (length(btrim(register_name)) BETWEEN 1 AND 200),
  national_number TEXT NOT NULL CHECK (length(btrim(national_number)) BETWEEN 1 AND 60),
  euid            TEXT CHECK (euid IS NULL OR length(euid) <= 80),
  role            TEXT NOT NULL CHECK (role IN ('primary', 'branch')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, jurisdiction, register_name, national_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS org_registrations_one_primary ON org_registrations(workspace_id) WHERE role = 'primary';
CREATE INDEX IF NOT EXISTS org_registrations_euid ON org_registrations(euid) WHERE euid IS NOT NULL;
-- Rule 5: a VAT prefix is its own list, not ISO 3166 (EL not GR, XI for Northern Ireland; EU/IM/IN are another namespace).
-- Rule 6: a national block is a string of up to 12 that admits + * . and letters; never an integer.
CREATE TABLE IF NOT EXISTS org_tax_identifiers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scheme       TEXT NOT NULL CHECK (scheme IN ('vat', 'oss', 'tin')),
  prefix       TEXT CHECK (prefix IS NULL OR prefix ~ '^[A-Z]{2}$'),
  number       TEXT NOT NULL CHECK (length(number) BETWEEN 1 AND 40),
  jurisdiction TEXT NOT NULL CHECK (jurisdiction ~ '^[A-Z]{2}(-[A-Z0-9]{1,6})?$'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (scheme <> 'vat' OR (prefix IS NOT NULL AND prefix <> 'GR' AND prefix <> 'GB' AND number ~ '^[0-9A-Za-z+*.]{2,12}$')),
  UNIQUE (workspace_id, scheme, prefix, number)
);
CREATE TABLE IF NOT EXISTS org_customs_identifiers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scheme       TEXT NOT NULL DEFAULT 'eori' CHECK (scheme IN ('eori')),
  number       TEXT NOT NULL CHECK (length(number) BETWEEN 3 AND 40),
  jurisdiction TEXT NOT NULL CHECK (jurisdiction ~ '^[A-Z]{2}(-[A-Z0-9]{1,6})?$'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, scheme, number)
);
-- Rule 9: an LEI has a status and a renewal date, never a boolean. LAPSED reads "active" at GLEIF and not to a regulator.
CREATE TABLE IF NOT EXISTS org_financial_identifiers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scheme       TEXT NOT NULL DEFAULT 'lei' CHECK (scheme IN ('lei')),
  number       TEXT NOT NULL CHECK (number ~ '^[A-Z0-9]{20}$'),
  status       TEXT NOT NULL CHECK (status IN ('ISSUED', 'LAPSED', 'RETIRED', 'ANNULLED', 'DUPLICATE', 'PENDING_VALIDATION', 'PENDING_TRANSFER', 'PENDING_ARCHIVAL', 'CANCELLED', 'TRANSFERRED')),
  next_renewal_date DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, scheme, number)
);
-- Rules 7, 8: three results, and every consultation is kept. An unreachable register is not an invalid number.
CREATE TABLE IF NOT EXISTS org_identifier_checks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_identifier_id   UUID REFERENCES org_tax_identifiers(id) ON DELETE SET NULL,
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  identifier          TEXT NOT NULL,
  result              TEXT NOT NULL CHECK (result IN ('valid', 'invalid', 'unverifiable')),
  consultation_number TEXT,
  raw_response        JSONB,
  checked_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  checked_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS org_identifier_checks_tax ON org_identifier_checks(tax_identifier_id, checked_at DESC);
-- A consultation is evidence: it can't be changed. A row goes only when its workspace does.
CREATE OR REPLACE FUNCTION org_identifier_checks_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'tax_identifier_id' - 'checked_by_user_id') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'tax_identifier_id' - 'checked_by_user_id') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'an identifier check is a record and cannot be changed' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS org_identifier_checks_no_update ON org_identifier_checks;
CREATE TRIGGER org_identifier_checks_no_update BEFORE UPDATE ON org_identifier_checks FOR EACH ROW EXECUTE FUNCTION org_identifier_checks_append_only();
-- Rule 13: who may act for the company, on what, alone or jointly. Date of birth is for those who manage the company.
CREATE TABLE IF NOT EXISTS org_mandates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_name   TEXT NOT NULL CHECK (length(btrim(person_name)) BETWEEN 1 AND 200),
  date_of_birth DATE,
  role          TEXT NOT NULL CHECK (length(btrim(role)) BETWEEN 1 AND 120),
  authority     TEXT NOT NULL CHECK (authority IN ('sole', 'joint')),
  scope         TEXT CHECK (scope IS NULL OR length(scope) <= 2000),
  subject_agent_user_id UUID REFERENCES users(id) ON DELETE SET NULL,   -- an agent acting for the company carries a mandate too
  valid_from    DATE,
  valid_until   DATE,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
);
CREATE INDEX IF NOT EXISTS org_mandates_workspace ON org_mandates(workspace_id);

-- DOWN
DROP TABLE IF EXISTS org_mandates;
DROP TRIGGER IF EXISTS org_identifier_checks_no_update ON org_identifier_checks;
DROP FUNCTION IF EXISTS org_identifier_checks_append_only();
DROP TABLE IF EXISTS org_identifier_checks;
DROP TABLE IF EXISTS org_financial_identifiers;
DROP TABLE IF EXISTS org_customs_identifiers;
DROP TABLE IF EXISTS org_tax_identifiers;
DROP TABLE IF EXISTS org_registrations;
DROP TABLE IF EXISTS org_profiles;
