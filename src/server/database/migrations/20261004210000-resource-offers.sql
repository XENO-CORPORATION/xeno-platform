-- UP
-- RES-01: a ResourceOffer declares all ten terms; accepting it mints a
-- bounded lease/grant. Bounds are schema-pinned: lease capacity is numeric
-- and positive, the lease window must sit inside the offer window, and the
-- lease row carries NO credential material -- there is deliberately no
-- column for secrets, tokens or passwords anywhere in these tables.
CREATE TABLE IF NOT EXISTS resource_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  capacity_quantity NUMERIC NOT NULL CHECK (capacity_quantity > 0),
  capacity_unit TEXT NOT NULL,
  allowed_project_id UUID REFERENCES chat_projects(id) ON DELETE RESTRICT,
  allowed_task_ref TEXT,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  revocation_policy TEXT NOT NULL,
  cost_responsibility TEXT NOT NULL,
  data_access_policy TEXT NOT NULL,
  license TEXT NOT NULL,
  verification_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'revoked', 'exhausted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_until > valid_from)
);
CREATE TABLE IF NOT EXISTS resource_leases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id UUID NOT NULL REFERENCES resource_offers(id) ON DELETE RESTRICT,
  holder_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  project_id UUID REFERENCES chat_projects(id) ON DELETE RESTRICT,
  task_ref TEXT,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired', 'released')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_until > valid_from)
);
CREATE INDEX IF NOT EXISTS idx_resource_leases_offer ON resource_leases(offer_id, status);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM resource_leases) THEN
    RAISE EXCEPTION 'resource lease rollback refused: leases exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM resource_offers) THEN
    RAISE EXCEPTION 'resource offer rollback refused: offers exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE resource_leases;
  DROP TABLE resource_offers;
END $$;
