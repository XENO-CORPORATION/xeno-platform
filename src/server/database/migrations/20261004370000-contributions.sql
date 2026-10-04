-- UP
-- PUB-05: every contribution carries a type, author, responsible
-- human/account, optional agent/team provenance, target task/project,
-- immutable submitted revisions, evidence and review state. All eight
-- contribution types share one record shape; the revision is an opaque
-- string, never forced into a Git commit. Submitted revisions are
-- append-only by trigger law.
CREATE TABLE IF NOT EXISTS contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE CASCADE,
  task_id UUID REFERENCES project_tasks(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('code', 'documentation', 'design-assets', 'dataset',
    'evaluation', 'agent-work', 'credits', 'resource-offer')),
  author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  responsible_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provenance JSONB CHECK (provenance IS NULL OR jsonb_typeof(provenance) = 'object'),
  current_revision_no INTEGER NOT NULL DEFAULT 0 CHECK (current_revision_no >= 0),
  review_state TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_state IN ('pending', 'in-review', 'accepted', 'rejected', 'withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS contribution_revisions (
  contribution_id UUID NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  revision_hash TEXT NOT NULL CHECK (length(btrim(revision_hash)) BETWEEN 1 AND 512),
  evidence JSONB NOT NULL CHECK (jsonb_typeof(evidence) = 'array'),
  submitted_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (contribution_id, revision_no)
);
CREATE FUNCTION contribution_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'submitted revisions are immutable; submit a new revision instead' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER contribution_revisions_immutable BEFORE UPDATE OR DELETE ON contribution_revisions
  FOR EACH ROW EXECUTE FUNCTION contribution_revision_immutable();
CREATE TRIGGER contribution_revisions_no_truncate BEFORE TRUNCATE ON contribution_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION contribution_revision_immutable();
CREATE INDEX IF NOT EXISTS idx_contributions_project ON contributions(project_id, type);
DO $harden$ BEGIN
  EXECUTE format('ALTER FUNCTION %I.contribution_revision_immutable() SET search_path = %I, pg_temp',
    current_schema(), current_schema());
END $harden$;
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM contribution_revisions) THEN
    RAISE EXCEPTION 'contribution rollback refused: revisions exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM contributions) THEN
    RAISE EXCEPTION 'contribution rollback refused: contributions exist' USING ERRCODE='23514';
  END IF;
  DROP TRIGGER contribution_revisions_no_truncate ON contribution_revisions;
  DROP TRIGGER contribution_revisions_immutable ON contribution_revisions;
  DROP FUNCTION contribution_revision_immutable();
  DROP TABLE contribution_revisions;
  DROP TABLE contributions;
END $$;
