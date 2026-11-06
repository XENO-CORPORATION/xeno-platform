-- A platform agent's own connection keeps the services it was created with, so an agent older than XENO Message
-- (2026-10-24) can't reach a channel and a wake on mention couldn't answer. Nobody can have turned off a service that
-- did not exist yet, so add this one once. Later connections started with it: if it's off there, its person chose that.
UPDATE mcp_connections SET categories = array_append(categories, 'message')
 WHERE client_id LIKE 'agent:%' AND revoked_at IS NULL AND created_at < '2026-10-23' AND NOT ('message' = ANY(categories));
