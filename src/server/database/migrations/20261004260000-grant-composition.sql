-- UP
-- RES-06: marketplace rentals, free agent offers, donated resources and
-- credit contributions are DISTINCT grant types with separate owners and
-- consents, composed under one task admission. No exchange rate exists
-- between resource claims and credits: each grant carries exactly one leg
-- (a resource lease OR a credit amount, never both, never neither), pinned
-- by schema, and the admission records legs separately without conversion.
CREATE TABLE IF NOT EXISTS resource_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('marketplace-rental', 'free-agent-offer', 'donated-resource', 'credit-contribution')),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  resource_lease_id UUID REFERENCES resource_leases(id) ON DELETE RESTRICT,
  credit_amount NUMERIC CHECK (credit_amount IS NULL OR credit_amount > 0),
  consent_scope TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'composed', 'revoked')),
  consented_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((resource_lease_id IS NULL) <> (credit_amount IS NULL))
);
CREATE TABLE IF NOT EXISTS task_grant_admissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_ref TEXT NOT NULL,
  scheduler_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS admission_grant_legs (
  admission_id UUID NOT NULL REFERENCES task_grant_admissions(id) ON DELETE CASCADE,
  grant_id UUID NOT NULL REFERENCES resource_grants(id) ON DELETE RESTRICT,
  PRIMARY KEY (admission_id, grant_id),
  UNIQUE (grant_id)
);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM admission_grant_legs) THEN
    RAISE EXCEPTION 'admission rollback refused: composed legs exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM task_grant_admissions) THEN
    RAISE EXCEPTION 'admission rollback refused: admissions exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM resource_grants) THEN
    RAISE EXCEPTION 'grant rollback refused: grants exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE admission_grant_legs;
  DROP TABLE task_grant_admissions;
  DROP TABLE resource_grants;
END $$;
