-- UP
-- Public immutable abandonment uses the existing operation serialization/identity.
-- No TTL/cascade: delayed mutations must always encounter the tombstone.
CREATE INDEX IF NOT EXISTS workspace_operation_abandonment_actor ON workspace_key_operations(actor_user_id,client_id) WHERE receipt ? 'abandoned';
-- DOWN
-- Retain tombstones and their bounded lookup on rollback.
