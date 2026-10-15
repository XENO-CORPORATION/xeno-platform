-- UP
-- "Act as": a person's sign-in from an agent app (an MCP client) can act as ONE of their own agents, chosen on the
-- consent screen, instead of a per-app agent made for it. One binding per person per client; absent means the
-- per-app agent (the behaviour before this). The token itself is unchanged -- the binding is read at use time, so
-- changing it, or the agent being deleted, takes effect on the next request without a new sign-in.
CREATE TABLE IF NOT EXISTS mcp_client_agent_bindings (
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  agent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, client_id)
);

-- the bound agent must be one the person OWNS (an agent identity whose owner is this person)
CREATE OR REPLACE FUNCTION mcp_client_agent_binding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM agent_identities WHERE user_id = NEW.agent_user_id AND owner_user_id = NEW.owner_user_id) THEN
    RAISE EXCEPTION 'an app can only act as an agent its person owns' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS mcp_client_agent_binding_guard ON mcp_client_agent_bindings;
CREATE TRIGGER mcp_client_agent_binding_guard BEFORE INSERT OR UPDATE ON mcp_client_agent_bindings
  FOR EACH ROW EXECUTE FUNCTION mcp_client_agent_binding_guard();

-- DOWN
DROP TRIGGER IF EXISTS mcp_client_agent_binding_guard ON mcp_client_agent_bindings;
DROP FUNCTION IF EXISTS mcp_client_agent_binding_guard();
DROP TABLE IF EXISTS mcp_client_agent_bindings;
