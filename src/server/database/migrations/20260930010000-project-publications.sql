-- UP
-- Publication is an explicit projection of an existing project, never a viewer grant.
CREATE TABLE project_publications (
  project_id UUID PRIMARY KEY REFERENCES chat_projects(id) ON DELETE RESTRICT,
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  draft JSONB,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','unlisted','public')),
  published_revision BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((visibility='private') OR published_revision IS NOT NULL),
  CHECK (draft IS NULL OR jsonb_typeof(draft)='object')
);
CREATE TABLE project_publication_versions (
  project_id UUID NOT NULL REFERENCES project_publications(project_id) ON DELETE RESTRICT,
  revision BIGINT NOT NULL CHECK (revision > 0),
  projection JSONB NOT NULL CHECK (jsonb_typeof(projection)='object'),
  preview_hash TEXT NOT NULL CHECK (preview_hash ~ '^[a-f0-9]{64}$'),
  actor_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id,revision)
);
ALTER TABLE project_publications ADD CONSTRAINT project_publication_published_version
  FOREIGN KEY(project_id,published_revision) REFERENCES project_publication_versions(project_id,revision) ON DELETE RESTRICT;
CREATE TABLE project_publication_operations (
  actor_user_id UUID NOT NULL,
  client_id VARCHAR(128) NOT NULL CHECK (client_id ~ '^[a-zA-Z0-9._-]{1,128}$'),
  operation_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE RESTRICT,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  incarnation_hash TEXT NOT NULL CHECK (incarnation_hash ~ '^[a-f0-9]{64}$'),
  receipt JSONB NOT NULL CHECK (jsonb_typeof(receipt)='object'),
  committed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_user_id,client_id,operation_id)
);
-- Archive/owner changes revoke publication permanently until a fresh explicit publish.
-- Merely checking current ownership on reads would resurrect it after A -> B -> A.
CREATE FUNCTION project_publication_context_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR (NEW.is_archived AND NOT OLD.is_archived) THEN
    UPDATE project_publications SET visibility='private',revision=revision+1,updated_at=now()
      WHERE project_id=NEW.id AND visibility<>'private';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER project_publication_context_change AFTER UPDATE OF owner_user_id,workspace_id,is_archived ON chat_projects
  FOR EACH ROW EXECUTE FUNCTION project_publication_context_change();

CREATE INDEX project_publications_discovery ON project_publications(project_id) WHERE visibility='public';
CREATE FUNCTION project_publication_retained() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'publication versions and receipts are immutable and retained' USING ERRCODE='23514';
END $$;
CREATE TRIGGER project_publication_versions_retained BEFORE UPDATE OR DELETE ON project_publication_versions
  FOR EACH ROW EXECUTE FUNCTION project_publication_retained();
CREATE TRIGGER project_publication_versions_no_truncate BEFORE TRUNCATE ON project_publication_versions
  FOR EACH STATEMENT EXECUTE FUNCTION project_publication_retained();
CREATE TRIGGER project_publication_operations_retained BEFORE UPDATE OR DELETE ON project_publication_operations
  FOR EACH ROW EXECUTE FUNCTION project_publication_retained();
CREATE TRIGGER project_publication_operations_no_truncate BEFORE TRUNCATE ON project_publication_operations
  FOR EACH STATEMENT EXECUTE FUNCTION project_publication_retained();
DO $harden$ BEGIN
  EXECUTE format('ALTER FUNCTION %I.project_publication_retained() SET search_path = %I, pg_temp',current_schema(),current_schema());
  EXECUTE format('ALTER FUNCTION %I.project_publication_context_change() SET search_path = %I, pg_temp',current_schema(),current_schema());
END $harden$;

-- DOWN
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM project_publications) OR EXISTS(SELECT 1 FROM project_publication_operations) THEN
    RAISE EXCEPTION 'publication rollback refused: retained state exists' USING ERRCODE='23514';
  END IF;
END $$;
DROP TRIGGER project_publication_context_change ON chat_projects;
DROP FUNCTION project_publication_context_change();
ALTER TABLE project_publications DROP CONSTRAINT project_publication_published_version;
DROP TABLE project_publication_operations;
DROP TABLE project_publication_versions;
DROP TABLE project_publications;
DROP FUNCTION project_publication_retained();
