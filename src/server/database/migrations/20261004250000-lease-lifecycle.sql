-- UP
-- RES-05: leases track revocation/expiry and verified settlement. Leases
-- have NO completed state -- capacity that disappears reads unavailable
-- (expired) or interrupted (revoked), never completed. Storage offers carry
-- agreed retention/export terms; settlements name their method and reference.
ALTER TABLE resource_offers ADD COLUMN IF NOT EXISTS retention_days INTEGER CHECK (retention_days IS NULL OR retention_days > 0);
ALTER TABLE resource_offers ADD COLUMN IF NOT EXISTS export_grace_days INTEGER CHECK (export_grace_days IS NULL OR export_grace_days > 0);
CREATE TABLE IF NOT EXISTS resource_lease_settlements (
  lease_id UUID PRIMARY KEY REFERENCES resource_leases(id) ON DELETE RESTRICT,
  method TEXT NOT NULL,
  reference TEXT NOT NULL,
  settled_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  settled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM resource_lease_settlements) THEN
    RAISE EXCEPTION 'lease settlement rollback refused: settlements exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE resource_lease_settlements;
  ALTER TABLE resource_offers DROP COLUMN IF EXISTS retention_days;
  ALTER TABLE resource_offers DROP COLUMN IF EXISTS export_grace_days;
END $$;
