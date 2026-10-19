-- UP
-- XENO MCP idempotency keys (XENO AGENT CAPABILITY - SPEC.md §19.3: a key for every non-safe capability).
-- A caller sends `Idempotency-Key`. The first call with a key records the capability and, once it ends, its
-- result; a repeat returns that result instead of acting twice (Stripe's model). The row is claimed BEFORE the
-- capability runs, so two concurrent repeats cannot both act. Unlike mcp_calls this keeps the result, because
-- replaying it is the point; rows older than 24 hours are not replayed and are deleted on contact.
CREATE TABLE IF NOT EXISTS mcp_idempotency (
  connection_id uuid NOT NULL REFERENCES mcp_connections(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 255),
  capability text NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, key)
);
CREATE INDEX IF NOT EXISTS mcp_idempotency_created ON mcp_idempotency (created_at);

-- DOWN
DROP TABLE IF EXISTS mcp_idempotency;
