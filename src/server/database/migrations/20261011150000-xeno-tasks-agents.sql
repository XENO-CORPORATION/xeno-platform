-- UP
-- XENO Tasks, agents (xeno-tasks/SPEC.md §4; the Linear-for-Agents model): a task keeps its HUMAN assignee, who is
-- accountable, and gets an AGENT delegate, who does the work. Agents act with their own scoped credential, never a
-- person's; the work starts when the agent is told (an event, pushed or pulled); and what the agent is doing is a
-- visible session on the task.

-- the agent working the task (always an agent identity); the assignee stays a person
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS delegate_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_delegate ON tasks(delegate_id, status) WHERE delegate_id IS NOT NULL;

-- an agent's credential for Tasks: issued to the agent identity, scoped (tasks:read, tasks:write), optionally to ONE
-- task (the hand-off link), expiring, revocable. Only a SHA-256 of the secret is stored; the prefix finds the row.
CREATE TABLE IF NOT EXISTS task_agent_tokens (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_prefix   TEXT NOT NULL UNIQUE CHECK (length(token_prefix) BETWEEN 8 AND 32),
  token_hash     TEXT NOT NULL CHECK (length(token_hash) = 64),
  agent_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id        UUID REFERENCES tasks(id) ON DELETE CASCADE,
  scopes         TEXT[] NOT NULL CHECK (scopes <@ ARRAY['tasks:read', 'tasks:write']::text[] AND cardinality(scopes) >= 1),
  label          TEXT NOT NULL DEFAULT '' CHECK (length(label) <= 80),
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  last_used_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_agent_tokens_agent ON task_agent_tokens(agent_user_id) WHERE revoked_at IS NULL;

-- where an agent wants to be told (one webhook per agent); the signing secret is stored to sign deliveries
CREATE TABLE IF NOT EXISTS task_agent_webhooks (
  agent_user_id  UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  owner_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url            TEXT NOT NULL CHECK (length(url) <= 2000),
  secret         TEXT NOT NULL CHECK (length(secret) BETWEEN 32 AND 128),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- what an agent is told: delegated, mentioned, a reply while it waits, changes asked. Pulled by cursor, or pushed.
CREATE TABLE IF NOT EXISTS task_agent_events (
  id              BIGSERIAL PRIMARY KEY,
  agent_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('delegated', 'undelegated', 'mentioned', 'reply', 'changes_requested', 'accepted')),
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at    TIMESTAMPTZ,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error      TEXT CHECK (last_error IS NULL OR length(last_error) <= 300)
);
CREATE INDEX IF NOT EXISTS idx_task_agent_events_agent ON task_agent_events(agent_user_id, id);
CREATE INDEX IF NOT EXISTS idx_task_agent_events_due ON task_agent_events(next_attempt_at) WHERE delivered_at IS NULL;

-- the agent's session on a task: what it is doing now, for the people on the task
CREATE TABLE IF NOT EXISTS task_agent_sessions (
  task_id        UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state          TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'working', 'awaiting_input', 'done', 'error')),
  last_note      TEXT NOT NULL DEFAULT '' CHECK (length(last_note) <= 500),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, agent_user_id)
);

ALTER TABLE task_events DROP CONSTRAINT IF EXISTS task_events_kind_check;
ALTER TABLE task_events ADD CONSTRAINT task_events_kind_check CHECK (kind IN ('created', 'edited', 'status', 'assigned', 'claimed', 'comment', 'attached', 'detached', 'deleted', 'restored', 'linked', 'unlinked', 'parent', 'delegated', 'activity'));

-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tasks WHERE delegate_id IS NOT NULL) OR EXISTS (SELECT 1 FROM task_agent_tokens)
     OR EXISTS (SELECT 1 FROM task_agent_events) OR EXISTS (SELECT 1 FROM task_events WHERE kind IN ('delegated', 'activity')) THEN
    RAISE EXCEPTION 'xeno-tasks agents rollback refused: agent data exists' USING ERRCODE = '23514';
  END IF;
  DROP TABLE IF EXISTS task_agent_sessions;
  DROP TABLE IF EXISTS task_agent_events;
  DROP TABLE IF EXISTS task_agent_webhooks;
  DROP TABLE IF EXISTS task_agent_tokens;
  ALTER TABLE task_events DROP CONSTRAINT IF EXISTS task_events_kind_check;
  ALTER TABLE task_events ADD CONSTRAINT task_events_kind_check CHECK (kind IN ('created', 'edited', 'status', 'assigned', 'claimed', 'comment', 'attached', 'detached', 'deleted', 'restored', 'linked', 'unlinked', 'parent'));
  ALTER TABLE tasks DROP COLUMN IF EXISTS delegate_id;
END $$;
