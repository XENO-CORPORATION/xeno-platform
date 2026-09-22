-- Additive cutover: retain existing webhook IDs, payloads and delivery history.
-- Stop old application workers before migration: old versions do not honor leases.
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS event_id text;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS destination_url text;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS destination_updated_at timestamptz;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS lease_token uuid;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS lease_owner text;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS fence bigint NOT NULL DEFAULT 0;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS error_code text;
UPDATE webhook_deliveries d SET
  state = CASE WHEN d.delivered_at IS NOT NULL THEN 'delivered' WHEN d.failed_at IS NOT NULL THEN 'failed' ELSE 'queued' END,
  event_id = 'legacy:' || d.id::text,
  destination_url = w.url, destination_updated_at = w.updated_at
FROM webhooks w WHERE d.webhook_id = w.id AND d.state IS NULL;
ALTER TABLE webhook_deliveries ALTER COLUMN state SET DEFAULT 'queued';
ALTER TABLE webhook_deliveries ALTER COLUMN state SET NOT NULL;
ALTER TABLE webhook_deliveries ALTER COLUMN event_id SET NOT NULL;
ALTER TABLE webhook_deliveries ALTER COLUMN attempt SET DEFAULT 0;
ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_delivery_state_valid
  CHECK (state IN ('queued', 'leased', 'delivered', 'failed', 'cancelled'));
CREATE UNIQUE INDEX IF NOT EXISTS webhook_delivery_destination_event ON webhook_deliveries(webhook_id, event_id);
CREATE INDEX IF NOT EXISTS webhook_delivery_due ON webhook_deliveries(state, next_retry_at, lease_expires_at, created_at);
CREATE OR REPLACE FUNCTION enforce_webhook_delivery_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event IS DISTINCT FROM OLD.event OR NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.payload IS DISTINCT FROM OLD.payload
    OR NEW.webhook_id IS DISTINCT FROM OLD.webhook_id THEN
    RAISE EXCEPTION 'Notification event identity conflicts with persisted content' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER webhook_delivery_identity_immutable BEFORE UPDATE OF event,event_id,payload,webhook_id ON webhook_deliveries
  FOR EACH ROW EXECUTE FUNCTION enforce_webhook_delivery_identity();
