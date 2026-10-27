-- XENO Compute: the timeline records each XENO Agent task run on a machine (how it ran, not what it was asked).
ALTER TABLE compute_events DROP CONSTRAINT IF EXISTS compute_events_kind_check;
ALTER TABLE compute_events ADD CONSTRAINT compute_events_kind_check
  CHECK (kind IN ('created', 'started', 'stopped', 'deleted', 'failed', 'billed', 'unfunded', 'funded', 'capped', 'idle_stop_set', 'agent_task'));
