-- UP
-- PUB-10: submissions are reviewed and merged by exact revision. Reviews
-- and reproducible check results name the revision they judged; a new
-- revision supersedes them. Each revision may carry a retrievable
-- artifact locator (diff or versioned artifact) plus run references
-- alongside its opaque hash; license and provenance already live on
-- the contribution record.
CREATE TABLE IF NOT EXISTS contribution_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id UUID NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  reviewer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'request_changes', 'reject')),
  rationale TEXT NOT NULL CHECK (length(btrim(rationale)) BETWEEN 1 AND 4000),
  superseded BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contribution_reviews_lookup
  ON contribution_reviews(contribution_id, revision_no, created_at);
CREATE TABLE IF NOT EXISTS contribution_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id UUID NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  status TEXT NOT NULL CHECK (status IN ('pass', 'fail')),
  definition_ref TEXT NOT NULL CHECK (length(btrim(definition_ref)) BETWEEN 1 AND 512),
  input_digest TEXT NOT NULL CHECK (length(btrim(input_digest)) BETWEEN 1 AND 512),
  run_ref TEXT NULL CHECK (run_ref IS NULL OR length(btrim(run_ref)) BETWEEN 1 AND 512),
  recorded_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  superseded BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contribution_checks_lookup
  ON contribution_checks(contribution_id, revision_no, created_at);
ALTER TABLE contribution_revisions ADD COLUMN IF NOT EXISTS artifact JSONB NULL;
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM contribution_reviews) THEN
    RAISE EXCEPTION 'submission rollback refused: reviews exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM contribution_checks) THEN
    RAISE EXCEPTION 'submission rollback refused: checks exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM contribution_revisions WHERE artifact IS NOT NULL) THEN
    RAISE EXCEPTION 'submission rollback refused: artifacts exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE contribution_reviews;
  DROP TABLE contribution_checks;
  ALTER TABLE contribution_revisions DROP COLUMN artifact;
END $$;
