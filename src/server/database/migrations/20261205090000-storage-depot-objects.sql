-- UP
-- XENO Storage: the Depot namespace (xeno-depot decision 0001 §4). XENO Depot's version-control server (Lore)
-- keeps its content-addressed, write-once objects here instead of in an object store of its own.
--   * One row per object, per workspace: the same hash in two workspaces is two objects (Lore's rule that a hash
--     never matches across partitions), so one tenant can never read, or poison, another's content.
--   * `hash` is the name Depot gives the object (Lore's 32-byte BLAKE3 hash, hex); Storage treats it as opaque.
--   * `payload_sha256` is the SHA-256 of the stored bytes, checked on the way in: the wire check, and the
--     tie-breaker that turns a second, different write under one name into a refusal instead of an overwrite.
--   * `meta` is one small opaque value written with the object and never changed (Lore keeps its fragment
--     description on the object the same way, as `x-amz-meta-lore-fragment`).
--   * A row means the object was written AND read back at its size. The meter (storageAllowance.js) sums
--     these rows into the workspace's pool, as kind `depot`; there is no counter.
-- Additive: it changes no existing table.
CREATE TABLE IF NOT EXISTS storage_depot_objects (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  meta text CHECK (meta IS NULL OR length(meta) <= 1024),
  object_key text NOT NULL,
  backend text NOT NULL,
  stored_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, hash)
);
-- DOWN
-- Retained deliberately: the rows are the record of which object holds which Depot content, and the meter.
