-- UP
-- XENO-WORKFORCE-01: one agent is TWO linked records, and projects sit in divisions.
--
-- OWN-02: "Agent identity, versioned agent definition and runtime principal are distinct." The workforce
-- resource (kind 'agent') is WHAT the agent is -- owner, versions, owning division, assignments. The
-- agent_identities row is WHO acts -- the principal that signs in, holds credentials and is named on work.
-- Until now nothing joined them, so a platform agent had a principal and no definition, and a workforce
-- agent had a definition and could not act. This adds the one edge: a principal names the definition it
-- runs. At most one principal per definition (UNIQUE), so "who is this agent" never forks.
--
-- DIV-04: a project has AT MOST ONE owning division inside its owning workspace. workforce_division_ownership
-- covers agents and teams only (its resource_kind CHECK), so projects get their own edge table rather than a
-- widened one: chat_projects is not a workforce resource and must not pretend to be one. Absence is
-- workspace-level and legitimate (ASN-06).

ALTER TABLE agent_identities ADD COLUMN IF NOT EXISTS workforce_resource_id UUID;
ALTER TABLE agent_identities ADD COLUMN IF NOT EXISTS workforce_resource_kind TEXT
  CHECK (workforce_resource_kind IS NULL OR workforce_resource_kind = 'agent');
-- the kind column lets the composite FK refuse a TEAM resource as an agent's definition
ALTER TABLE agent_identities DROP CONSTRAINT IF EXISTS agent_identity_workforce_resource_fk;
ALTER TABLE agent_identities ADD CONSTRAINT agent_identity_workforce_resource_fk
  FOREIGN KEY (workforce_resource_id, workforce_resource_kind) REFERENCES workforce_resources(id, kind) ON DELETE RESTRICT;
ALTER TABLE agent_identities DROP CONSTRAINT IF EXISTS agent_identity_workforce_pair;
ALTER TABLE agent_identities ADD CONSTRAINT agent_identity_workforce_pair
  CHECK ((workforce_resource_id IS NULL) = (workforce_resource_kind IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS agent_identities_workforce_resource ON agent_identities (workforce_resource_id)
  WHERE workforce_resource_id IS NOT NULL;

-- A principal's definition is fixed once linked: re-pointing it would silently make an existing identity --
-- its credentials, its history, its name on tasks -- a different agent.
CREATE OR REPLACE FUNCTION agent_identity_workforce_link_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.workforce_resource_id IS NOT NULL AND NEW.workforce_resource_id IS DISTINCT FROM OLD.workforce_resource_id THEN
    RAISE EXCEPTION 'an agent identity cannot change the definition it runs' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS agent_identity_workforce_link_guard ON agent_identities;
CREATE TRIGGER agent_identity_workforce_link_guard BEFORE UPDATE ON agent_identities
  FOR EACH ROW EXECUTE FUNCTION agent_identity_workforce_link_guard();

CREATE TABLE IF NOT EXISTS workforce_project_divisions (
  project_id UUID PRIMARY KEY REFERENCES chat_projects(id) ON DELETE CASCADE,   -- PRIMARY KEY: at most one owning division
  division_id UUID NOT NULL REFERENCES workforce_divisions(id) ON DELETE RESTRICT,
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workforce_project_divisions_division ON workforce_project_divisions (division_id);

-- The division must be in the project's OWN workspace, and an archived division admits nothing new
-- (DIV-02, OWN-06). A personally-owned project sits in a division of its owner's personal workspace.
CREATE OR REPLACE FUNCTION workforce_project_division_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p_ws UUID; p_owner UUID; d_ws UUID; d_state TEXT; personal_ws UUID;
BEGIN
  SELECT workspace_id, owner_user_id INTO p_ws, p_owner FROM chat_projects WHERE id = NEW.project_id;
  SELECT workspace_id, lifecycle INTO d_ws, d_state FROM workforce_divisions WHERE id = NEW.division_id;
  IF p_ws IS NULL THEN
    SELECT id INTO personal_ws FROM workspaces WHERE owner_user_id = p_owner AND workspace_type = 'personal' ORDER BY created_at LIMIT 1;
    p_ws := personal_ws;
  END IF;
  IF p_ws IS NULL OR p_ws <> d_ws THEN
    RAISE EXCEPTION 'a project can only belong to a division of its own workspace' USING ERRCODE = '23514';
  END IF;
  IF d_state <> 'active' AND (TG_OP = 'INSERT' OR NEW.division_id <> OLD.division_id) THEN
    RAISE EXCEPTION 'an archived division admits no new projects' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'project division revision must advance by exactly one' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workforce_project_division_guard ON workforce_project_divisions;
CREATE TRIGGER workforce_project_division_guard BEFORE INSERT OR UPDATE ON workforce_project_divisions
  FOR EACH ROW EXECUTE FUNCTION workforce_project_division_guard();

-- DOWN
DROP TRIGGER IF EXISTS workforce_project_division_guard ON workforce_project_divisions;
DROP FUNCTION IF EXISTS workforce_project_division_guard();
DROP TABLE IF EXISTS workforce_project_divisions;
DROP TRIGGER IF EXISTS agent_identity_workforce_link_guard ON agent_identities;
DROP FUNCTION IF EXISTS agent_identity_workforce_link_guard();
DROP INDEX IF EXISTS agent_identities_workforce_resource;
ALTER TABLE agent_identities DROP CONSTRAINT IF EXISTS agent_identity_workforce_pair;
ALTER TABLE agent_identities DROP CONSTRAINT IF EXISTS agent_identity_workforce_resource_fk;
ALTER TABLE agent_identities DROP COLUMN IF EXISTS workforce_resource_kind;
ALTER TABLE agent_identities DROP COLUMN IF EXISTS workforce_resource_id;
