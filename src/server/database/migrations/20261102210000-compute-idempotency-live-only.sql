-- A deleted machine stops holding its idempotency key. The index covered every row, so createMachine went on answering a
-- deleted machine for that key for good: Cloud Shell, which always uses the same key, could never start again for a person
-- whose shell machine had been deleted. A retry of a create still finds the machine while it exists; the deleted row keeps
-- the key it was created with, as a record.
-- UP
DROP INDEX IF EXISTS compute_machines_idempotency;
CREATE UNIQUE INDEX compute_machines_idempotency ON compute_machines (workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND state <> 'deleted';

-- DOWN
-- Refuses if a key is now used by both a deleted machine and a later one, which the older index cannot hold.
DROP INDEX IF EXISTS compute_machines_idempotency;
CREATE UNIQUE INDEX compute_machines_idempotency ON compute_machines (workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
