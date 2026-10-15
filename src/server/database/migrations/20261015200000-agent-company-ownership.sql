-- UP
-- XENO-WORKFORCE-01 OWN-01/OWN-05 + MKT-01 for platform agents: a company (workspace) can own an agent, the agent
-- survives the person who made it, and four rights are granted separately.
--
--  - OWNERSHIP is the agent's definition (workforce_resources.owner_workspace_id). The workspace owns it.
--  - ACCOUNTABILITY is agent_identities.owner_user_id: the HUMAN answerable for what it does. For a company agent
--    that human must be an admin of the owning workspace; when they stop being one (or are suspended), the agent
--    PAUSES -- it is not deleted, its history and definition stay -- until a workspace admin takes it over.
--    Read live in resolvePrincipal (the same derived cascade as a suspended owner), so no path can forget it.
--  - TAKEOVER and HANDOVER are recorded here, one row per change of the accountable human, with who did it and why.
--  - THE FOUR RIGHTS (MKT-01) are relations on `agent:<user id>` in relationship_tuples:
--      viewer (see it) < runner (run it: credentials, cloud runs) < editor (change it); exporter (take the
--    definition out) is separate and never implied. Workspace admins hold all four. No new table.

CREATE TABLE IF NOT EXISTS agent_accountability_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  to_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NULL REFERENCES workspaces(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN ('transfer', 'takeover', 'handover')),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 1000),
  decided_by_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_accountability_changes_agent ON agent_accountability_changes (agent_user_id, created_at DESC);

-- every grant and revoke of one of the four rights, with who decided
CREATE TABLE IF NOT EXISTS agent_access_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_right text NOT NULL CHECK (access_right IN ('viewer', 'runner', 'editor', 'exporter')),
  granted boolean NOT NULL,
  decided_by_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_access_changes_agent ON agent_access_changes (agent_user_id, created_at DESC);

-- history is append-only
CREATE OR REPLACE FUNCTION agent_accountability_changes_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'agent accountability history is append-only' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS agent_accountability_changes_append_only ON agent_accountability_changes;
CREATE TRIGGER agent_accountability_changes_append_only BEFORE UPDATE OR DELETE ON agent_accountability_changes
  FOR EACH ROW EXECUTE FUNCTION agent_accountability_changes_append_only();
DROP TRIGGER IF EXISTS agent_access_changes_append_only ON agent_access_changes;
CREATE TRIGGER agent_access_changes_append_only BEFORE UPDATE OR DELETE ON agent_access_changes
  FOR EACH ROW EXECUTE FUNCTION agent_accountability_changes_append_only();

-- DOWN
DROP TRIGGER IF EXISTS agent_access_changes_append_only ON agent_access_changes;
DROP TABLE IF EXISTS agent_access_changes;
DROP TRIGGER IF EXISTS agent_accountability_changes_append_only ON agent_accountability_changes;
DROP FUNCTION IF EXISTS agent_accountability_changes_append_only();
DROP TABLE IF EXISTS agent_accountability_changes;
