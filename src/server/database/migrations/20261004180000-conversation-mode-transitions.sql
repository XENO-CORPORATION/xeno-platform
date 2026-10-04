-- UP
-- SES-03: Chat->Agent requires an explicit authorized root, records the
-- mode/context change, and preserves continuity. Conversations carry their
-- mode; every Chat->Agent move inserts a transition row pinning from/to,
-- the authorizing root (a project the actor holds, or the conversation's
-- SES-02 session-isolated workdir), the authorizer, and a pending-state
-- snapshot. Coherence is schema-pinned: project roots name their project,
-- session roots name none.
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'chat';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_conversations_mode_check') THEN
    ALTER TABLE chat_conversations ADD CONSTRAINT chat_conversations_mode_check CHECK (mode IN ('chat','agent'));
  END IF;
END $$;
CREATE TABLE conversation_mode_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  from_mode TEXT NOT NULL CHECK (from_mode IN ('chat','agent')),
  to_mode TEXT NOT NULL CHECK (to_mode IN ('chat','agent')),
  CHECK (from_mode <> to_mode),
  root_kind TEXT NOT NULL CHECK (root_kind IN ('project','session-isolated')),
  root_project_id UUID REFERENCES chat_projects(id) ON DELETE RESTRICT,
  CHECK ((root_kind = 'project') = (root_project_id IS NOT NULL)),
  authorized_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  pending_state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversation_mode_transitions_conv ON conversation_mode_transitions(conversation_id, created_at DESC);

-- DOWN
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM conversation_mode_transitions) THEN
    RAISE EXCEPTION 'mode transition rollback refused: recorded transitions exist' USING ERRCODE='23514';
  END IF;
END $$;
DROP TABLE conversation_mode_transitions;
ALTER TABLE chat_conversations DROP CONSTRAINT IF EXISTS chat_conversations_mode_check;
ALTER TABLE chat_conversations DROP COLUMN IF EXISTS mode;
