-- UP
-- XENO Tasks: claim leases, typed agent activity, and the full agent event feed (owner-approved 2026-10-18).
--
-- 1. A claim made with a run id holds a LEASE: one live (agent, run) per task, renewed by heartbeat, ended by release
--    or by expiry. Without it the same agent on two PCs both "won" a claim, and a crashed run left a task held forever.
--    The task's state before the claim is kept on the lease, so an expired lease can put the task back in the queue.
CREATE TABLE IF NOT EXISTS task_claim_leases (
  task_id          UUID PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  agent_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id           TEXT NOT NULL CHECK (run_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  status_before    TEXT NOT NULL,
  delegate_before  UUID REFERENCES users(id) ON DELETE SET NULL,
  claimed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  heartbeat_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_claim_leases_expiry ON task_claim_leases(expires_at);

-- 2. Typed activity (plan | action | question | handover | done) keeps its structured fields with the event.
ALTER TABLE task_events ADD COLUMN IF NOT EXISTS data JSONB CHECK (data IS NULL OR (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 65536));
ALTER TABLE task_events DROP CONSTRAINT IF EXISTS task_events_kind_check;
ALTER TABLE task_events ADD CONSTRAINT task_events_kind_check CHECK (kind IN ('created', 'edited', 'status', 'assigned', 'claimed', 'comment', 'attached', 'detached', 'deleted', 'restored', 'linked', 'unlinked', 'parent', 'delegated', 'activity', 'released', 'lease_expired'));

-- 3. What an agent's inbox must hear about, beyond delegation, mentions, replies and review outcomes.
ALTER TABLE task_agent_events DROP CONSTRAINT IF EXISTS task_agent_events_kind_check;
ALTER TABLE task_agent_events ADD CONSTRAINT task_agent_events_kind_check CHECK (kind IN ('delegated', 'undelegated', 'mentioned', 'reply', 'changes_requested', 'accepted',
  'status_changed', 'review_requested', 'lease_expired', 'handover'));

-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM task_claim_leases) OR EXISTS (SELECT 1 FROM task_events WHERE kind IN ('released', 'lease_expired') OR data IS NOT NULL)
     OR EXISTS (SELECT 1 FROM task_agent_events WHERE kind IN ('status_changed', 'review_requested', 'lease_expired', 'handover')) THEN
    RAISE EXCEPTION 'xeno-tasks claim-lease rollback refused: lease or typed-activity data exists' USING ERRCODE = '23514';
  END IF;
  ALTER TABLE task_agent_events DROP CONSTRAINT IF EXISTS task_agent_events_kind_check;
  ALTER TABLE task_agent_events ADD CONSTRAINT task_agent_events_kind_check CHECK (kind IN ('delegated', 'undelegated', 'mentioned', 'reply', 'changes_requested', 'accepted'));
  ALTER TABLE task_events DROP CONSTRAINT IF EXISTS task_events_kind_check;
  ALTER TABLE task_events ADD CONSTRAINT task_events_kind_check CHECK (kind IN ('created', 'edited', 'status', 'assigned', 'claimed', 'comment', 'attached', 'detached', 'deleted', 'restored', 'linked', 'unlinked', 'parent', 'delegated', 'activity'));
  ALTER TABLE task_events DROP COLUMN IF EXISTS data;
  DROP TABLE IF EXISTS task_claim_leases;
END $$;
