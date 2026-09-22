-- UP
-- XENO-WORKFORCE-01 WS-02: configuration identity, not a runtime principal.
-- No legacy identity backfill, memberships, assignments or ReBAC parent edges.
CREATE TABLE workforce_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('agent', 'team')),
  owner_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  owner_workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name VARCHAR(200) NOT NULL CHECK (length(btrim(name)) > 0),
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workforce_resources_owner_check CHECK (num_nonnulls(owner_user_id, owner_workspace_id) = 1),
  UNIQUE (id, kind)
);
CREATE INDEX workforce_resources_personal_catalog
  ON workforce_resources(owner_user_id, status, created_at DESC, id DESC) WHERE owner_user_id IS NOT NULL;
CREATE INDEX workforce_resources_workspace_catalog
  ON workforce_resources(owner_workspace_id, status, created_at DESC, id DESC) WHERE owner_workspace_id IS NOT NULL;
CREATE INDEX workforce_resources_creator ON workforce_resources(created_by_user_id) WHERE created_by_user_id IS NOT NULL;

CREATE TABLE workforce_agent_versions (
  resource_id UUID NOT NULL,
  -- Composite FK enforces agent-kind even under concurrent changes to resources.
  resource_kind TEXT NOT NULL DEFAULT 'agent' CHECK (resource_kind = 'agent'),
  version INTEGER NOT NULL CHECK (version > 0),
  content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  -- Service validates the versioned definition and computes a canonical hash of
  -- its complete pinned payload. JSONB text ordering is not a wire hash format.
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
  license JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(license) = 'object'),
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (resource_id, version),
  FOREIGN KEY (resource_id, resource_kind) REFERENCES workforce_resources(id, kind) ON DELETE RESTRICT
);
CREATE INDEX workforce_agent_versions_creator ON workforce_agent_versions(created_by_user_id) WHERE created_by_user_id IS NOT NULL;

CREATE FUNCTION workforce_agent_version_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- FK erasure may remove attribution only, after the creator row disappears.
  -- No content, hash, identity, license, provenance or timestamp can change.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.created_by_user_id IS NOT NULL AND NEW.created_by_user_id IS NULL
       AND (to_jsonb(NEW) - 'created_by_user_id') = (to_jsonb(OLD) - 'created_by_user_id')
       AND NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.created_by_user_id) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'workforce agent versions are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER workforce_agent_versions_immutable
BEFORE UPDATE OR DELETE ON workforce_agent_versions
FOR EACH ROW EXECUTE FUNCTION workforce_agent_version_immutable();
CREATE TRIGGER workforce_agent_versions_no_truncate
BEFORE TRUNCATE ON workforce_agent_versions
FOR EACH STATEMENT EXECUTE FUNCTION workforce_agent_version_immutable();

-- DOWN
-- Additive bootstrap only: a populated installation requires a separately
-- reviewed retention/migration plan. Never silently discard retained versions.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM workforce_resources) OR EXISTS (SELECT 1 FROM workforce_agent_versions) THEN
    RAISE EXCEPTION 'workforce rollback refused: retained resources exist' USING ERRCODE = '23514';
  END IF;
END $$;
DROP TABLE workforce_agent_versions;
DROP FUNCTION workforce_agent_version_immutable();
DROP TABLE workforce_resources;
