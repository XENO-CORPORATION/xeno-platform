-- UP
-- Operational groups are not workspace memberships or permission grants.
CREATE TABLE workspace_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
  description varchar(2000) NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
CREATE UNIQUE INDEX workspace_teams_live_name ON workspace_teams(workspace_id, lower(name)) WHERE archived_at IS NULL;
-- Composite FK prevents assignments from silently following a project to another tenant.
ALTER TABLE chat_projects ADD CONSTRAINT chat_projects_workspace_identity UNIQUE (workspace_id, id);
CREATE TABLE workspace_team_projects (
  workspace_id uuid NOT NULL,
  team_id uuid NOT NULL,
  project_id uuid NOT NULL,
  PRIMARY KEY (team_id, project_id),
  FOREIGN KEY (workspace_id, team_id) REFERENCES workspace_teams(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, project_id) REFERENCES chat_projects(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX workspace_team_projects_project ON workspace_team_projects(project_id);
CREATE TABLE workspace_team_agents (
  workspace_id uuid NOT NULL,
  team_id uuid NOT NULL,
  agent_id uuid NOT NULL REFERENCES agent_identities(user_id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, agent_id),
  UNIQUE (workspace_id, agent_id),
  FOREIGN KEY (workspace_id, team_id) REFERENCES workspace_teams(workspace_id, id) ON DELETE CASCADE
);
