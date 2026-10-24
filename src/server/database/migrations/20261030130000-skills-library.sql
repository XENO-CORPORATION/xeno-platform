-- UP
-- The skills library (docs/AGENT-IDENTITY-SKILLS-CORPUS.md D2/D3, owner 2026-10-24). A skill is the open Agent Skills
-- format every agent CLI reads: a SKILL.md (name + description front-matter, body loaded on demand) plus files. A
-- skill belongs to one person or one workspace; each version is IMMUTABLE and carries the SHA-256 of its files, which
-- is exactly the {id, version, hash} an agent version already pins (XENO-WORKFORCE-01 OWN-03). Publishing to everyone
-- is a later, separate step (a Marketplace listing of kind 'skill').
-- ADDITIVE ONLY: two tables, one function, two triggers, and 'skills' added to live agent connections' categories;
-- the undo section removes exactly them.
CREATE TABLE IF NOT EXISTS skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE CHECK (public_id ~ '^skl_[0-9a-f]{32}$'),
  -- one owner: a person, or a workspace (whose editors write it and whose members use it)
  owner_user_id uuid NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 1024),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz NULL,
  CHECK ((owner_user_id IS NULL) <> (workspace_id IS NULL))
);
-- a name is unique within its owner, so `skills_get <name>` is unambiguous for an agent
CREATE UNIQUE INDEX IF NOT EXISTS skills_name_personal ON skills (owner_user_id, name) WHERE owner_user_id IS NOT NULL AND archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS skills_name_workspace ON skills (workspace_id, name) WHERE workspace_id IS NOT NULL AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS skill_versions (
  skill_id uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  version text NOT NULL CHECK (version ~ '^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}$'),
  -- the files, SKILL.md first: [{ "path": "SKILL.md", "content": "…" }, …] (text only, size-capped by the service)
  files jsonb NOT NULL CHECK (jsonb_typeof(files) = 'array' AND jsonb_array_length(files) BETWEEN 1 AND 64),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (skill_id, version)
);

-- a version, once made, never changes: a pinned {id, version, hash} must always name the same bytes
CREATE OR REPLACE FUNCTION skill_versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'a skill version never changes; publish a new version instead' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS skill_versions_no_update ON skill_versions;
CREATE TRIGGER skill_versions_no_update BEFORE UPDATE ON skill_versions FOR EACH ROW EXECUTE FUNCTION skill_versions_immutable();
-- deleting a version is refused too; a whole skill goes only with its owner (ON DELETE CASCADE from skills)
DROP TRIGGER IF EXISTS skill_versions_no_delete ON skill_versions;
CREATE TRIGGER skill_versions_no_delete BEFORE DELETE ON skill_versions FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION skill_versions_immutable();

-- A platform agent's own connection starts with every agent service (xenoMcp AGENT_DEFAULT_CATEGORIES). Connections made
-- before 'skills' existed lack it, and nobody can have turned off a category that did not exist yet: add it once.
UPDATE mcp_connections SET categories = array_append(categories, 'skills')
 WHERE client_id LIKE 'agent:%' AND revoked_at IS NULL AND NOT ('skills' = ANY(categories));

-- DOWN
UPDATE mcp_connections SET categories = array_remove(categories, 'skills') WHERE client_id LIKE 'agent:%';
DROP TRIGGER IF EXISTS skill_versions_no_delete ON skill_versions;
DROP TRIGGER IF EXISTS skill_versions_no_update ON skill_versions;
DROP FUNCTION IF EXISTS skill_versions_immutable();
DROP TABLE IF EXISTS skill_versions;
DROP TABLE IF EXISTS skills;
