-- UP
-- SES-05: scope moves are recorded with their audience and history manifest.
--
-- Moving/sharing a conversation is separate from mode/root changes: this
-- table pins from-scope, to-scope, the declared target audience and the
-- exact message count that moved with it. A move row is the no-silent-
-- transfer evidence: the audience shown at move time is what the database
-- says moved.
CREATE TABLE IF NOT EXISTS conversation_scope_moves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  from_scope TEXT NOT NULL,
  to_scope TEXT NOT NULL,
  audience_type TEXT NOT NULL CHECK (audience_type IN ('project', 'user')),
  audience_id UUID NOT NULL,
  history_message_count INTEGER NOT NULL CHECK (history_message_count >= 0),
  moved_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_scope <> to_scope)
);
CREATE INDEX IF NOT EXISTS idx_conversation_scope_moves_conv
  ON conversation_scope_moves(conversation_id, created_at DESC);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM conversation_scope_moves) THEN
    RAISE EXCEPTION 'scope move rollback refused: recorded moves exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE conversation_scope_moves;
END $$;
