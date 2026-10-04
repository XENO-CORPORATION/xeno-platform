-- UP
-- PUB-13: going private revokes future public access across the
-- controlled services and records what was revoked — with an explicit
-- warning that taken copies cannot be recalled. The external
-- repository mirror has its own visibility, independent of the XENO
-- project in both directions. Artifact links may attribute a project
-- so retreat can reach exactly those links.
CREATE TABLE IF NOT EXISTS project_repositories (
  project_id UUID PRIMARY KEY REFERENCES chat_projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (length(btrim(provider)) BETWEEN 1 AND 80),
  remote_url TEXT NOT NULL CHECK (length(btrim(remote_url)) BETWEEN 1 AND 512),
  repo_visibility TEXT NOT NULL CHECK (repo_visibility IN ('public', 'private')),
  linked_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS project_visibility_retreats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE CASCADE,
  from_visibility TEXT NOT NULL,
  publication_revoked BOOLEAN NOT NULL,
  revoked_conversation_publications INTEGER NOT NULL,
  revoked_share_links INTEGER NOT NULL,
  revoked_artifact_links INTEGER NOT NULL,
  warning TEXT NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_visibility_retreats_project
  ON project_visibility_retreats(project_id, created_at);
ALTER TABLE artifact_public_links ADD COLUMN IF NOT EXISTS project_id UUID NULL
  REFERENCES chat_projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_artifact_public_links_project ON artifact_public_links(project_id);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM project_visibility_retreats) THEN
    RAISE EXCEPTION 'retreat rollback refused: retreats exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM project_repositories) THEN
    RAISE EXCEPTION 'retreat rollback refused: repository links exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM artifact_public_links WHERE project_id IS NOT NULL) THEN
    RAISE EXCEPTION 'retreat rollback refused: project-scoped links exist' USING ERRCODE='23514';
  END IF;
  ALTER TABLE artifact_public_links DROP COLUMN project_id;
  DROP TABLE project_visibility_retreats;
  DROP TABLE project_repositories;
END $$;
