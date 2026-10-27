-- XENO Compute: a machine nobody is using stops by itself (owner gap, 2026-10-27).
-- Additive only. idle_stop_minutes NULL = never stop for idleness (the person's choice, shown on the machine).
-- last_active_at moves forward on start, on every command (to the command's deadline while it runs) and file call.
ALTER TABLE compute_machines
  ADD COLUMN IF NOT EXISTS idle_stop_minutes integer DEFAULT 30
    CHECK (idle_stop_minutes IS NULL OR idle_stop_minutes BETWEEN 5 AND 1440),
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz;

-- the timeline records a change of the idle limit
ALTER TABLE compute_events DROP CONSTRAINT IF EXISTS compute_events_kind_check;
ALTER TABLE compute_events ADD CONSTRAINT compute_events_kind_check
  CHECK (kind IN ('created', 'started', 'stopped', 'deleted', 'failed', 'billed', 'unfunded', 'funded', 'capped', 'idle_stop_set'));
