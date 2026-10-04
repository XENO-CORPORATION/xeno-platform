-- UP
-- PUB-04: a contribution declares its origin, rights/license and
-- contributor agreement, and records the terms version it was submitted
-- under. Projects declare their contribution terms, including whether a
-- contributor agreement is required. Columns are nullable so existing
-- rows keep standing; the submission path requires declarations on all
-- new contributions.
ALTER TABLE contributions
  ADD COLUMN IF NOT EXISTS origin TEXT CHECK (origin IS NULL OR length(btrim(origin)) BETWEEN 1 AND 500),
  ADD COLUMN IF NOT EXISTS rights_license TEXT CHECK (rights_license IS NULL OR length(btrim(rights_license)) BETWEEN 1 AND 500),
  ADD COLUMN IF NOT EXISTS cla_id TEXT CHECK (cla_id IS NULL OR length(btrim(cla_id)) BETWEEN 1 AND 200),
  ADD COLUMN IF NOT EXISTS terms_version TEXT CHECK (terms_version IS NULL OR length(btrim(terms_version)) BETWEEN 1 AND 120);
CREATE TABLE IF NOT EXISTS project_contribution_terms (
  project_id UUID PRIMARY KEY REFERENCES chat_projects(id) ON DELETE CASCADE,
  requires_cla BOOLEAN NOT NULL DEFAULT FALSE,
  cla_id TEXT CHECK (cla_id IS NULL OR length(btrim(cla_id)) BETWEEN 1 AND 200),
  cla_version TEXT CHECK (cla_version IS NULL OR length(btrim(cla_version)) BETWEEN 1 AND 120),
  CHECK ((requires_cla = FALSE) OR (cla_id IS NOT NULL)),
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM project_contribution_terms WHERE requires_cla) THEN
    RAISE EXCEPTION 'contribution terms rollback refused: CLA requirements exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM contributions WHERE origin IS NOT NULL OR rights_license IS NOT NULL) THEN
    RAISE EXCEPTION 'contribution rights rollback refused: declarations exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE project_contribution_terms;
  ALTER TABLE contributions DROP COLUMN terms_version;
  ALTER TABLE contributions DROP COLUMN cla_id;
  ALTER TABLE contributions DROP COLUMN rights_license;
  ALTER TABLE contributions DROP COLUMN origin;
END $$;
