-- UP
-- SES-09: the storage contract preserves crash recovery, deliberate
-- branch/rewind intent and completed turns. Turns append per branch as
-- complete or partial (crashed); intents record abandon/rewind decisions;
-- recovery reads the newest unambiguous valid continuation. Completed turns
-- are never deleted or rewritten by any of these paths.
CREATE TABLE IF NOT EXISTS conversation_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  branch TEXT NOT NULL DEFAULT 'main' CHECK (branch <> ''),
  turn_index INTEGER NOT NULL CHECK (turn_index >= 0),
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('complete', 'partial')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, branch, turn_index)
);
CREATE TABLE IF NOT EXISTS conversation_branch_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  branch TEXT NOT NULL CHECK (branch <> ''),
  intent TEXT NOT NULL CHECK (intent IN ('abandon', 'rewind-to')),
  target_turn INTEGER CHECK (target_turn IS NULL OR target_turn >= 0),
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((intent = 'abandon') = (target_turn IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_conversation_turns_conv ON conversation_turns(conversation_id, branch, turn_index);
CREATE INDEX IF NOT EXISTS idx_conversation_branch_intents_conv ON conversation_branch_intents(conversation_id, branch, created_at DESC);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM conversation_branch_intents) THEN
    RAISE EXCEPTION 'branch intent rollback refused: intents exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM conversation_turns) THEN
    RAISE EXCEPTION 'turn rollback refused: turns exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE conversation_branch_intents;
  DROP TABLE conversation_turns;
END $$;
