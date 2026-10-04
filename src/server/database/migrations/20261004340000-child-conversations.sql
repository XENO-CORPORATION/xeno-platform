-- UP
-- RUN-05: a child conversation opens under a parent and returns to it
-- without being cancelled; only an explicit close ends it. Tool previews
-- are bounded at write time (the full output lives behind full_ref, never
-- inline); each preview carries its own collapsed flag so collapse toggles
-- one row and never rewrites the transcript.
CREATE TABLE IF NOT EXISTS child_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  child_conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  opened_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('open', 'returned', 'closed')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  returned_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  UNIQUE (child_conversation_id),
  CHECK (parent_conversation_id <> child_conversation_id),
  CHECK (state <> 'returned' OR returned_at IS NOT NULL),
  CHECK (state <> 'closed' OR closed_at IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS tool_previews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  tool_call_id TEXT NOT NULL,
  preview TEXT NOT NULL CHECK (char_length(preview) <= 4096),
  truncated BOOLEAN NOT NULL DEFAULT false,
  full_ref TEXT NOT NULL,
  collapsed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, tool_call_id)
);
CREATE INDEX IF NOT EXISTS idx_child_conversations_parent ON child_conversations(parent_conversation_id, state);
CREATE INDEX IF NOT EXISTS idx_tool_previews_conv ON tool_previews(conversation_id, created_at);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tool_previews) THEN
    RAISE EXCEPTION 'tool preview rollback refused: previews exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM child_conversations) THEN
    RAISE EXCEPTION 'child conversation rollback refused: links exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE tool_previews;
  DROP TABLE child_conversations;
END $$;
