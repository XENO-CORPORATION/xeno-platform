-- XENO Compute: how big each machine's saved home folder is (xeno-compute keeps it in R2 between runs).
-- Additive only. XENO Storage's meter counts this against the workspace's allowance (SPEC §2a).
ALTER TABLE compute_machines
  ADD COLUMN IF NOT EXISTS home_bytes bigint CHECK (home_bytes IS NULL OR home_bytes >= 0),
  ADD COLUMN IF NOT EXISTS home_saved_at timestamptz;
