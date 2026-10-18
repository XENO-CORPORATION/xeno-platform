-- UP
-- XENO MCP gained the `agents` category (agents_whoami, 2026-10-18). A platform agent's own credential connection
-- (client_id 'agent:agt_…') starts with every agent category (xenoMcp.js AGENT_DEFAULT_CATEGORIES), but connections
-- made before today stored the list without it, so give them the new one. It never existed before, so nobody can have
-- turned it off. App sign-ins (OAuth) are left as their person set them.
UPDATE mcp_connections SET categories = array_append(categories, 'agents')
 WHERE client_id LIKE 'agent:%' AND revoked_at IS NULL AND NOT ('agents' = ANY(categories));

-- DOWN
UPDATE mcp_connections SET categories = array_remove(categories, 'agents') WHERE client_id LIKE 'agent:%';
