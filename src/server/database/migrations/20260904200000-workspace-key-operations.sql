-- UP
-- Public mutation receipts only: never store plaintext/encrypted key secrets.
-- No TTL deletion: forgetting an operation would permit a delayed duplicate mint.
-- The service bounds each workspace to 10,000 receipts and refuses new operations
-- at capacity; existing receipt reads/replays remain available.
CREATE TABLE IF NOT EXISTS workspace_key_operations (
  -- Intentional tombstones: deleting/recreating a source row must not erase the
  -- duplicate fence. Current authority + incarnation checks gate every read.
  workspace_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  client_id VARCHAR(128) NOT NULL,
  operation_id UUID NOT NULL,
  request_hash CHAR(64) NOT NULL,
  incarnation_hash CHAR(64) NOT NULL,
  receipt JSONB NOT NULL CHECK (octet_length(receipt::text) <= 8192 AND NOT receipt ? 'secret'),
  committed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, actor_user_id, client_id, operation_id)
);
-- DOWN
DROP TABLE IF EXISTS workspace_key_operations;
