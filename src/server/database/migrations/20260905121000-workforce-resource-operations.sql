-- UP
-- Durable metadata-only creation receipts. Actor/owner UUIDs are intentional
-- tombstones, not cascading FKs: erasure must not forget a duplicate fence.
-- Reads require current usable principal + matching account/scope incarnation.
CREATE TABLE workforce_resource_operations (
  actor_user_id UUID NOT NULL,
  client_id VARCHAR(128) NOT NULL CHECK (client_id ~ '^[a-zA-Z0-9._-]{1,128}$'),
  operation_id UUID NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('user', 'workspace')),
  owner_id UUID NOT NULL,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  incarnation_hash TEXT NOT NULL CHECK (incarnation_hash ~ '^[0-9a-f]{64}$'),
  resource_id UUID NOT NULL REFERENCES workforce_resources(id) ON DELETE RESTRICT,
  resource_revision BIGINT NOT NULL CHECK (resource_revision > 0),
  agent_version INTEGER CHECK (agent_version > 0),
  committed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_user_id, client_id, operation_id),
  UNIQUE (resource_id),
  FOREIGN KEY (resource_id, agent_version) REFERENCES workforce_agent_versions(resource_id, version) ON DELETE RESTRICT
);
CREATE INDEX workforce_resource_operations_owner ON workforce_resource_operations(owner_type, owner_id, committed_at, operation_id);

CREATE FUNCTION workforce_resource_operation_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'workforce operation receipts are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER workforce_resource_operations_immutable
BEFORE UPDATE OR DELETE ON workforce_resource_operations
FOR EACH ROW EXECUTE FUNCTION workforce_resource_operation_immutable();
CREATE TRIGGER workforce_resource_operations_no_truncate
BEFORE TRUNCATE ON workforce_resource_operations
FOR EACH STATEMENT EXECUTE FUNCTION workforce_resource_operation_immutable();

-- DOWN
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM workforce_resource_operations) THEN
    RAISE EXCEPTION 'workforce receipt rollback refused: committed operations exist' USING ERRCODE = '23514';
  END IF;
END $$;
DROP TABLE workforce_resource_operations;
DROP FUNCTION workforce_resource_operation_immutable();
