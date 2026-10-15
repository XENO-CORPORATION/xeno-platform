-- UP
-- XENO MCP: one hosted MCP address for every agent, managed from the platform (XENO AGENT SURFACES &
-- CONNECTORS - SPEC.md §7). A CONNECTION is one signed-in client for one person: its own registered OAuth
-- client, its own per-app agent, its own categories. The call log records metadata only — never a tool's
-- arguments or result, which are the person's content.
CREATE TABLE IF NOT EXISTS mcp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  client_name text NOT NULL,
  -- the categories this connection may reach; a tool outside them is neither listed nor callable
  categories text[] NOT NULL DEFAULT '{tasks}',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
-- one live connection per person per registered client: signing the same client in again reuses it
CREATE UNIQUE INDEX IF NOT EXISTS mcp_connections_live ON mcp_connections (owner_user_id, client_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS mcp_connections_owner ON mcp_connections (owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mcp_calls (
  id bigserial PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES mcp_connections(id) ON DELETE CASCADE,
  tool text NOT NULL,
  category text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  latency_ms integer NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('ok', 'tool_error', 'refused', 'timeout', 'failed')),
  error_code text,
  credits_micro bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS mcp_calls_connection ON mcp_calls (connection_id, started_at DESC);

-- DOWN
DROP TABLE IF EXISTS mcp_calls;
DROP TABLE IF EXISTS mcp_connections;
