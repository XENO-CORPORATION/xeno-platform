-- Agent owner-sync streams update one canonical chat_messages row. The source
-- identity is installation-scoped by chat_agent_conversation_mappings; every
-- admitted revision still has its own immutable chat_agent_sync_receipt and
-- monotonically ordered chat_collaboration_event.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS source_message_id TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS source_revision BIGINT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS source_state TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chat_messages_agent_source_check'
      AND conrelid = 'chat_messages'::regclass
  ) THEN
    ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_agent_source_check CHECK (
      (source_message_id IS NULL AND source_revision IS NULL AND source_state IS NULL)
      OR
      (source_message_id IS NOT NULL
       AND char_length(source_message_id) BETWEEN 8 AND 128
       AND source_message_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
       AND source_revision BETWEEN 1 AND 9007199254740991
       AND source_state IN ('streaming', 'complete')
       AND role IN ('user', 'assistant'))
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_messages_agent_source
  ON chat_messages(conversation_id, source_message_id)
  WHERE source_message_id IS NOT NULL;

-- DOWN
DROP INDEX IF EXISTS uq_chat_messages_agent_source;
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_agent_source_check;
ALTER TABLE chat_messages DROP COLUMN IF EXISTS source_state;
ALTER TABLE chat_messages DROP COLUMN IF EXISTS source_revision;
ALTER TABLE chat_messages DROP COLUMN IF EXISTS source_message_id;
