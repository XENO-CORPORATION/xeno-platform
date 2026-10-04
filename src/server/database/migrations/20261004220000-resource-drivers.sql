-- UP
-- RES-02: each resource family needs its own admitted driver plus a measurable
-- receipt before any offer of that family is advertised as usable. Drivers
-- are admitted per family with a probe receipt carrying a measured quantity;
-- offers of unadmitted families (or unknown kinds) may be recorded as
-- proposals, never listed as delivered capacity.
CREATE TABLE IF NOT EXISTS resource_drivers (
  family TEXT PRIMARY KEY CHECK (family IN ('licensed-asset', 'storage', 'compute')),
  driver_name TEXT NOT NULL,
  admitted BOOLEAN NOT NULL DEFAULT FALSE,
  admitted_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  probe_receipt JSONB,
  admitted_at TIMESTAMPTZ,
  CHECK (admitted = FALSE OR (admitted_by_user_id IS NOT NULL AND probe_receipt IS NOT NULL AND admitted_at IS NOT NULL))
);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_offers_status_check') THEN
    ALTER TABLE resource_offers DROP CONSTRAINT resource_offers_status_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_offers_status_check') THEN
    ALTER TABLE resource_offers ADD CONSTRAINT resource_offers_status_check
      CHECK (status IN ('open', 'revoked', 'exhausted', 'proposal'));
  END IF;
END $$;
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM resource_drivers WHERE admitted) THEN
    RAISE EXCEPTION 'resource driver rollback refused: admitted drivers exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM resource_offers WHERE status = 'proposal') THEN
    RAISE EXCEPTION 'resource offer rollback refused: proposals exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE resource_drivers;
  ALTER TABLE resource_offers DROP CONSTRAINT resource_offers_status_check;
  ALTER TABLE resource_offers ADD CONSTRAINT resource_offers_status_check
    CHECK (status IN ('open', 'revoked', 'exhausted'));
END $$;
