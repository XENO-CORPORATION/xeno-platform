-- UP
-- SES-07: CLI, GUI, Hub embed and provider TUI adapters share one
-- authoritative session/event lineage with a single execution-owner lease.
-- Every tool, notification and provider command is a sequenced structured
-- event; terminal ANSI lives in presentation only, never in business data.
CREATE TABLE IF NOT EXISTS session_event_lineage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  seq BIGINT NOT NULL CHECK (seq > 0),
  adapter TEXT NOT NULL CHECK (adapter IN ('cli', 'gui', 'hub', 'provider-tui')),
  kind TEXT NOT NULL CHECK (kind IN ('tool', 'notification', 'provider-command', 'note', 'state')),
  payload JSONB NOT NULL,
  presentation TEXT,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, seq)
);
CREATE TABLE IF NOT EXISTS session_execution_leases (
  conversation_id UUID PRIMARY KEY REFERENCES chat_conversations(id) ON DELETE CASCADE,
  holder_adapter TEXT NOT NULL CHECK (holder_adapter IN ('cli', 'gui', 'hub', 'provider-tui')),
  holder_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_session_event_lineage_conv ON session_event_lineage(conversation_id, seq);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM session_execution_leases) THEN
    RAISE EXCEPTION 'execution lease rollback refused: leases exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM session_event_lineage) THEN
    RAISE EXCEPTION 'lineage rollback refused: events exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE session_execution_leases;
  DROP TABLE session_event_lineage;
END $$;
