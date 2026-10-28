-- XENO Compute named ports (/api/compute/machines/:id/ports/:name): a browser cannot put a token on a WebSocket, so it
-- asks for a one-use ticket (60 s) and offers it when it connects. Only the ticket's hash is kept. The timeline records
-- who connected to which port (not what was said over it).
CREATE TABLE IF NOT EXISTS compute_port_tickets (
  ticket_hash TEXT PRIMARY KEY CHECK (ticket_hash ~ '^[0-9a-f]{64}$'),
  machine_id TEXT NOT NULL REFERENCES compute_machines(id) ON DELETE CASCADE,
  port TEXT NOT NULL CHECK (port ~ '^[a-z][a-z0-9-]{0,31}$'),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes')
);
CREATE INDEX IF NOT EXISTS compute_port_tickets_expiry ON compute_port_tickets (expires_at);

ALTER TABLE compute_events DROP CONSTRAINT IF EXISTS compute_events_kind_check;
ALTER TABLE compute_events ADD CONSTRAINT compute_events_kind_check
  CHECK (kind IN ('created', 'started', 'stopped', 'deleted', 'failed', 'billed', 'unfunded', 'funded', 'capped', 'idle_stop_set', 'agent_task', 'port_opened'));
