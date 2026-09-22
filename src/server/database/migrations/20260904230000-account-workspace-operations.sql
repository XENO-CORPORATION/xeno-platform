-- UP
-- Account-owned intent namespace: creation has no existing workspace. This is
-- not a copy of workspace membership receipts and must never use a dummy UUID.
-- No cascades/TTL: forgetting a fence would permit delayed duplicate creation.
CREATE TABLE account_workspace_operations (
  actor_user_id UUID NOT NULL,
  client_id VARCHAR(128) NOT NULL,
  operation_id UUID NOT NULL,
  account_incarnation CHAR(64) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  request JSONB NOT NULL CHECK (octet_length(request::text)<=2048),
  target_hash CHAR(64),
  state TEXT NOT NULL CHECK (state IN ('prepared','committed','rejected','abandoned')),
  receipt JSONB NOT NULL CHECK (octet_length(receipt::text)<=8192),
  PRIMARY KEY(actor_user_id,client_id,operation_id)
);
CREATE FUNCTION protect_account_workspace_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state<>'prepared' OR ROW(OLD.actor_user_id,OLD.client_id,OLD.operation_id,OLD.account_incarnation,OLD.request_hash,OLD.request,OLD.target_hash)
    IS DISTINCT FROM ROW(NEW.actor_user_id,NEW.client_id,NEW.operation_id,NEW.account_incarnation,NEW.request_hash,NEW.request,NEW.target_hash)
    OR NEW.state='prepared' THEN RAISE EXCEPTION 'account workspace intent is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER account_workspace_intent_immutable BEFORE UPDATE ON account_workspace_operations FOR EACH ROW EXECUTE FUNCTION protect_account_workspace_intent();
-- DOWN
-- Deliberately retain duplicate fences on rollback.
