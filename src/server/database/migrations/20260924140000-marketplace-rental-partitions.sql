-- XENO-WORKFORCE-01 MKT-07 / MKT-08 / MKT-09 -- rental memory, partitioned, renter-owned.
--
-- MKT-07: "Physically exclude seller-private memory at context load. Rental context includes reviewed
--          serving material and the permitted renter partition. Partition by entitlement plus target
--          ownership/security scope; one entitlement must not merge two confidential workspaces."
-- MKT-08: "rental learning stays partition-local; seller cannot inspect/promote renter content
--          automatically. Optional improvement-sharing is a separate explicit renter-authorized
--          disclosure, with reviewed content and audit, never a condition hidden in rental terms."
-- MKT-09: "Renter export/deletion applies to their content without exposing seller model/definition/
--          private memory or bypassing retention requirements. Revocation is not a claim that
--          previously exported data can be recalled."
--
-- Seller material a rental may SEE is a separate, reviewed column. Everything else a seller ships
-- (the artifact, the manifest, any private memory) lives where the context loader never selects it.
ALTER TABLE marketplace_listing_versions
  ADD COLUMN IF NOT EXISTS serving_material TEXT CHECK (serving_material IS NULL OR length(serving_material) <= 20000),
  ADD COLUMN IF NOT EXISTS serving_material_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS serving_material_reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- One partition per (entitlement, target). A renter's personal use and each workspace they bind to are
-- separate partitions, so two confidential workspaces under one entitlement never share memory.
CREATE TABLE IF NOT EXISTS marketplace_rental_partitions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_id      UUID NOT NULL REFERENCES marketplace_entitlements(id) ON DELETE RESTRICT,
  renter_user_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  target_workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_rental_partitions_target
  ON marketplace_rental_partitions (entitlement_id, COALESCE(target_workspace_id, '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE marketplace_rental_bindings
  ADD COLUMN IF NOT EXISTS partition_id UUID REFERENCES marketplace_rental_partitions(id) ON DELETE RESTRICT;

-- Renter content: what the rental learned while working for THIS partition.
CREATE TABLE IF NOT EXISTS marketplace_rental_memory (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partition_id          UUID NOT NULL REFERENCES marketplace_rental_partitions(id) ON DELETE RESTRICT,
  kind                  VARCHAR(16) NOT NULL CHECK (kind IN ('exchange','note')),
  content               TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 20000),
  source_invocation_id  UUID REFERENCES marketplace_invocations(id) ON DELETE SET NULL,
  -- A retention requirement (legal hold, dispute) keeps an item past a renter's deletion request.
  retain_until          TIMESTAMPTZ,
  retain_reason         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_rental_memory_retention CHECK ((retain_until IS NULL) = (retain_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS marketplace_rental_memory_partition ON marketplace_rental_memory (partition_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_rental_memory_one_per_invocation
  ON marketplace_rental_memory (source_invocation_id) WHERE kind = 'exchange' AND source_invocation_id IS NOT NULL;

-- The ONLY way renter content reaches a seller: the renter picks items, reviews the exact snapshot and
-- authorizes it. The snapshot is what the seller sees -- later edits or deletions do not change it.
CREATE TABLE IF NOT EXISTS marketplace_rental_disclosures (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partition_id      UUID NOT NULL REFERENCES marketplace_rental_partitions(id) ON DELETE RESTRICT,
  listing_id        UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE RESTRICT,
  authorized_by     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason            TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  snapshot          JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'array' AND jsonb_array_length(snapshot) BETWEEN 1 AND 200),
  authorized_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketplace_rental_disclosures_listing ON marketplace_rental_disclosures (listing_id, authorized_at DESC);

-- Every seller read of a disclosure is recorded.
CREATE TABLE IF NOT EXISTS marketplace_rental_disclosure_access (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disclosure_id  UUID NOT NULL REFERENCES marketplace_rental_disclosures(id) ON DELETE RESTRICT,
  accessed_by    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  accessed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every export a renter takes. Revocation never deletes these: an exported copy is outside our reach.
CREATE TABLE IF NOT EXISTS marketplace_rental_exports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partition_id    UUID NOT NULL REFERENCES marketplace_rental_partitions(id) ON DELETE RESTRICT,
  exported_by     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  item_count      INTEGER NOT NULL CHECK (item_count >= 0),
  exported_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE marketplace_invocations ADD COLUMN IF NOT EXISTS partition_recorded_at TIMESTAMPTZ;
