-- UP
-- Additive explicit capability metadata for existing account API keys.
-- No existing key gains any workforce grant; key minting remains unchanged.
CREATE TABLE api_key_workforce_capabilities (
  api_key_id UUID PRIMARY KEY REFERENCES api_keys(id) ON DELETE CASCADE,
  scopes TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(scopes)<=2
    AND array_position(scopes,NULL) IS NULL AND scopes <@ ARRAY['workforce:read','workforce:manage']::TEXT[]
    AND (cardinality(scopes)<2 OR scopes[1]<>scopes[2])),
  revision BIGINT NOT NULL CHECK (revision>0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Fixed-column, immutable operation receipts also serve as the grant-change audit.
-- Key or account erasure must not erase a previously acknowledged audit receipt.
CREATE TABLE api_key_workforce_operations (
  actor_user_id UUID NOT NULL,
  client_id TEXT NOT NULL CHECK(length(client_id) BETWEEN 1 AND 128),
  operation_id UUID NOT NULL,
  api_key_id UUID NOT NULL,
  key_incarnation_hash TEXT NOT NULL CHECK(key_incarnation_hash ~ '^[a-f0-9]{64}$'),
  request_hash TEXT NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  action TEXT NOT NULL CHECK(action IN ('set-scopes','revoke-key')),
  scopes TEXT[] NOT NULL CHECK (cardinality(scopes)<=2 AND array_position(scopes,NULL) IS NULL
    AND scopes <@ ARRAY['workforce:read','workforce:manage']::TEXT[]
    AND (cardinality(scopes)<2 OR scopes[1]<>scopes[2])),
  revision BIGINT NOT NULL CHECK(revision>0),
  key_active BOOLEAN NOT NULL,
  committed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_user_id,client_id,operation_id)
);
CREATE FUNCTION api_key_workforce_operation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'API key workforce audit is immutable' USING ERRCODE='23514'; END;
$$;
CREATE TRIGGER api_key_workforce_operation_immutable BEFORE UPDATE OR DELETE ON api_key_workforce_operations
FOR EACH ROW EXECUTE FUNCTION api_key_workforce_operation_immutable();
CREATE TRIGGER api_key_workforce_operations_no_truncate BEFORE TRUNCATE ON api_key_workforce_operations
FOR EACH STATEMENT EXECUTE FUNCTION api_key_workforce_operation_immutable();
-- DOWN
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM api_key_workforce_capabilities) OR EXISTS(SELECT 1 FROM api_key_workforce_operations) THEN
    RAISE EXCEPTION 'API key workforce rollback refused: retained capabilities or audit exist' USING ERRCODE='23514';
  END IF;
END $$;
DROP TABLE api_key_workforce_operations;
DROP FUNCTION api_key_workforce_operation_immutable();
DROP TABLE api_key_workforce_capabilities;
