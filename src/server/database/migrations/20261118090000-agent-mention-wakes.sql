-- UP
-- An agent named in a channel can be woken: a cloud run on a task, paid by the person who answers for the agent.
-- A stranger's sentence must not spend someone's credits on its own, so this is off until that person turns it on.
-- ADDITIVE ONLY: two new tables. Message text stays here only while a wake waits to start.
CREATE TABLE IF NOT EXISTS agent_mention_settings (
  agent_user_id uuid PRIMARY KEY REFERENCES agent_identities (user_id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'people', 'everyone')),
  budget_credits integer NOT NULL DEFAULT 10 CHECK (budget_credits BETWEEN 1 AND 50),
  per_day integer NOT NULL DEFAULT 10 CHECK (per_day BETWEEN 1 AND 100),
  updated_by uuid NOT NULL REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Spending a person's credits is a person's choice: no agent turns this on, for itself or for another.
CREATE OR REPLACE FUNCTION agent_mention_settings_by_person() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM agent_identities WHERE user_id = NEW.updated_by) THEN
    RAISE EXCEPTION 'only a person can change when an agent wakes' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS agent_mention_settings_by_person ON agent_mention_settings;
CREATE TRIGGER agent_mention_settings_by_person BEFORE INSERT OR UPDATE ON agent_mention_settings
  FOR EACH ROW EXECUTE FUNCTION agent_mention_settings_by_person();

CREATE TABLE IF NOT EXISTS agent_mention_wakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_user_id uuid NOT NULL REFERENCES agent_identities (user_id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  sender_kind text NOT NULL CHECK (sender_kind IN ('human', 'agent', 'service')),
  sender_name text NOT NULL,
  workspace_id uuid NOT NULL,
  channel_key text NOT NULL,
  channel_title text NOT NULL,
  conversation_id uuid NOT NULL,                  -- Comms' id; nothing here references Comms' tables
  message_id uuid NOT NULL,
  ref text NOT NULL,
  message_text text,
  depth integer NOT NULL DEFAULT 0,               -- how many agents in a row led to this wake; a person's mention is 0
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'starting', 'started', 'merged', 'refused', 'cancelled', 'expired', 'failed')),
  reason text,
  task_key text,
  run_row_id uuid REFERENCES agent_cloud_runs (id) ON DELETE SET NULL,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_user_id, message_id)
);
CREATE INDEX IF NOT EXISTS agent_mention_wakes_queue ON agent_mention_wakes (created_at) WHERE state IN ('queued', 'starting');
CREATE INDEX IF NOT EXISTS agent_mention_wakes_agent ON agent_mention_wakes (agent_user_id, conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_mention_wakes_channel ON agent_mention_wakes (conversation_id, created_at DESC);

-- DOWN
DROP TABLE IF EXISTS agent_mention_wakes;
DROP TRIGGER IF EXISTS agent_mention_settings_by_person ON agent_mention_settings;
DROP FUNCTION IF EXISTS agent_mention_settings_by_person();
DROP TABLE IF EXISTS agent_mention_settings;
