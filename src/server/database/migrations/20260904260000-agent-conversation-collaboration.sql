-- Stable account/install scoped identity for Agent Interface conversations.
-- Local ids remain opaque compatibility identifiers; Platform owns the UUID.
CREATE TABLE IF NOT EXISTS chat_agent_conversation_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL UNIQUE REFERENCES chat_conversations(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL CHECK (char_length(client_id) BETWEEN 1 AND 128),
  installation_id TEXT NOT NULL CHECK (installation_id ~ '^[A-Za-z0-9_-]{43}$'),
  local_conversation_id TEXT NOT NULL CHECK (char_length(local_conversation_id) BETWEEN 1 AND 240),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id, client_id, installation_id, local_conversation_id)
);

CREATE TABLE IF NOT EXISTS chat_agent_sync_receipts (
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL CHECK (char_length(event_id) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(conversation_id, owner_user_id, event_id)
);

ALTER TABLE chat_collaboration_events DROP CONSTRAINT IF EXISTS chat_collaboration_events_event_type_check;
ALTER TABLE chat_collaboration_events ADD CONSTRAINT chat_collaboration_events_event_type_check
  CHECK (event_type IN (
    'share.created', 'participant.joined', 'participant.revoked',
    'share.revoked', 'comment.appended', 'message.appended',
    'owner.message.synced', 'owner.tool.synced'
  ));

CREATE INDEX IF NOT EXISTS idx_chat_agent_mapping_local
  ON chat_agent_conversation_mappings(owner_user_id, client_id, installation_id, local_conversation_id);

-- DOWN
-- Deliberately manual: removing this migration can orphan live share mappings.
