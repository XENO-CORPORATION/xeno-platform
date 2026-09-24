-- XENO-WORKFORCE-01 MKT-05: "Rental assignment references an active entitlement and hosted serving
-- version, not a downloadable private agent. Binding to workspace/project must be allowed by the
-- license. Expiry and revocation block new dispatch; consumed work remains accountable."
--
-- 1. A published version declares whether it may be SERVED (run by the platform on a renter's behalf)
--    and whether its private artifact may be DOWNLOADED. A rental uses the first, never the second.
-- 2. A listing's rental licence says where a rental may be bound: to the renter personally, to a
--    workspace the renter belongs to, and how many workspaces at once.
-- 3. A rental binding is the durable record that a rental entitlement is assigned to a target (the
--    renter, or one workspace), pinned to the serving version. Invocations carry the binding.
-- 4. Revocation is a state change with a reason; nothing is deleted, so the work already run under a
--    binding stays attached to it and to the invocations that record it.

ALTER TABLE marketplace_listing_versions
  ADD COLUMN IF NOT EXISTS servable BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN marketplace_listing_versions.servable IS
  'MKT-05: the platform may run this version as a hosted serving version on a renter''s behalf.';

ALTER TABLE marketplace_listings
  ADD COLUMN IF NOT EXISTS rental_license JSONB NOT NULL DEFAULT
    '{"schemaVersion":1,"personal":true,"workspace":false,"maxWorkspaces":0}'::jsonb;
ALTER TABLE marketplace_listings DROP CONSTRAINT IF EXISTS marketplace_listings_rental_license_shape;
ALTER TABLE marketplace_listings ADD CONSTRAINT marketplace_listings_rental_license_shape CHECK (
  jsonb_typeof(rental_license) = 'object'
  AND rental_license->'schemaVersion' = '1'::jsonb
  AND jsonb_typeof(rental_license->'personal') = 'boolean'
  AND jsonb_typeof(rental_license->'workspace') = 'boolean'
  AND jsonb_typeof(rental_license->'maxWorkspaces') = 'number'
  AND (rental_license->>'maxWorkspaces')::int BETWEEN 0 AND 1000
  AND ((rental_license->>'workspace')::boolean OR (rental_license->>'maxWorkspaces')::int = 0)
);

ALTER TABLE marketplace_entitlements
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_reason TEXT;

CREATE TABLE IF NOT EXISTS marketplace_rental_bindings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_id      UUID NOT NULL REFERENCES marketplace_entitlements(id) ON DELETE RESTRICT,
  listing_id          UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE RESTRICT,
  renter_user_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- NULL = bound to the renter personally; otherwise ONE workspace the renter belongs to.
  target_workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT,
  serving_version_id  UUID NOT NULL REFERENCES marketplace_listing_versions(id) ON DELETE RESTRICT,
  state               VARCHAR(12) NOT NULL DEFAULT 'active' CHECK (state IN ('active','revoked')),
  revoked_at          TIMESTAMPTZ,
  revoked_reason      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_rental_bindings_revocation
    CHECK ((state = 'revoked') = (revoked_at IS NOT NULL))
);
-- One live binding per (entitlement, target): a second bind to the same place is the same binding.
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_rental_bindings_live_target
  ON marketplace_rental_bindings (entitlement_id, COALESCE(target_workspace_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE state = 'active';
CREATE INDEX IF NOT EXISTS marketplace_rental_bindings_renter
  ON marketplace_rental_bindings (renter_user_id, state);

-- Every invocation made under a rental names the binding it ran under; that is what keeps consumed
-- work accountable after the rental ends.
ALTER TABLE marketplace_invocations
  ADD COLUMN IF NOT EXISTS binding_id UUID REFERENCES marketplace_rental_bindings(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS serving_version_id UUID REFERENCES marketplace_listing_versions(id) ON DELETE RESTRICT;
ALTER TABLE marketplace_invocations DROP CONSTRAINT IF EXISTS marketplace_invocations_rental_bound;
ALTER TABLE marketplace_invocations ADD CONSTRAINT marketplace_invocations_rental_bound
  CHECK (access <> 'rental' OR (binding_id IS NOT NULL AND serving_version_id IS NOT NULL));
