-- UP
-- XENO Storage: a workspace's own allowance for XENO Depot content (owner, 2026-11-21T20:25:41, session dbde4f58:
-- "we need to have like 1 TB or 2 TB allowance for the Depot for our xenosystem", typos corrected). A workspace with a
-- row here keeps its Depot objects against this cap and OUT of its plan's file pool, so a 105 GB repository never fills
-- a 5 GB workspace for ordinary files. Without a row, Depot objects count in the plan pool (storageAllowance.js).
-- It is a cap, not a counter: the meter still sums storage_depot_objects. `set_by` and `reason` say who decided it.
-- Additive: it changes no existing table.
CREATE TABLE IF NOT EXISTS storage_depot_allowances (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE RESTRICT,
  bytes bigint NOT NULL CHECK (bytes > 0),
  set_by text NOT NULL,
  reason text NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now()
);
-- DOWN
-- Retained deliberately: removing a row would move a workspace's Depot content back into its plan pool at once.
