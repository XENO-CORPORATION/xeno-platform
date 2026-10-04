-- UP
-- FORGE-04: mirrored subjects keep each side's fields in separate
-- columns with separate versions. Neither side can overwrite the
-- other's fields — there is no shared cell for last-write-wins to
-- fight over.
CREATE TABLE IF NOT EXISTS forge_mirrors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  binding_id UUID NOT NULL REFERENCES forge_bindings(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('task', 'change_request')),
  subject_id UUID NOT NULL,
  github_ref TEXT NOT NULL CHECK (length(btrim(github_ref)) BETWEEN 1 AND 128),
  github_state TEXT NULL,
  commit_sha TEXT NULL,
  pr_state TEXT NULL,
  xeno_status TEXT NULL,
  xeno_priority TEXT NULL,
  github_version BIGINT NOT NULL DEFAULT 0,
  xeno_version BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (binding_id, github_ref)
);
CREATE INDEX IF NOT EXISTS idx_forge_mirrors_subject ON forge_mirrors(subject_type, subject_id);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM forge_mirrors) THEN
    RAISE EXCEPTION 'authority rollback refused: mirrors exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE forge_mirrors;
END $$;
