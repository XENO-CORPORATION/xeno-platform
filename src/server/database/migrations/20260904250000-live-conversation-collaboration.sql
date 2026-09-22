-- Live collaboration stays on the original conversation. Snapshot shares keep
-- their copy-on-accept behavior, but all newly issued capabilities are digest-only.
ALTER TABLE chat_shared_conversations ALTER COLUMN share_token DROP NOT NULL;
UPDATE chat_shared_conversations SET share_token = NULL WHERE token_digest IS NOT NULL;
ALTER TABLE chat_shared_conversations ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'snapshot';
ALTER TABLE chat_shared_conversations ADD COLUMN IF NOT EXISTS participant_role TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_shared_conversations_mode_check') THEN
    ALTER TABLE chat_shared_conversations ADD CONSTRAINT chat_shared_conversations_mode_check
      CHECK ((mode = 'snapshot' AND participant_role IS NULL)
          OR (mode = 'live' AND participant_role IN ('viewer', 'commenter', 'contributor')));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS chat_live_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accepted_share_id UUID NOT NULL REFERENCES chat_shared_conversations(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'commenter', 'contributor')),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoked_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_collaboration_event_heads (
  conversation_id UUID PRIMARY KEY REFERENCES chat_conversations(id) ON DELETE CASCADE,
  last_sequence BIGINT NOT NULL DEFAULT 0 CHECK (last_sequence >= 0)
);

CREATE TABLE IF NOT EXISTS chat_collaboration_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  content TEXT NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 32768),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_collaboration_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'share.created', 'participant.joined', 'participant.revoked',
    'share.revoked', 'comment.appended', 'message.appended'
  )),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  participant_id UUID REFERENCES chat_live_participants(id) ON DELETE SET NULL,
  message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
  comment_id UUID REFERENCES chat_collaboration_comments(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(conversation_id, sequence)
);

CREATE TABLE IF NOT EXISTS chat_collaboration_idempotency (
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(conversation_id, actor_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_chat_live_participants_user
  ON chat_live_participants(user_id, conversation_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_collaboration_events_cursor
  ON chat_collaboration_events(conversation_id, sequence);
CREATE INDEX IF NOT EXISTS idx_chat_collaboration_idempotency_rate
  ON chat_collaboration_idempotency(conversation_id, actor_user_id, created_at DESC);

-- Collaboration relations intentionally do not use viewer/reviewer/editor.
-- The canonical ReBAC engine therefore stores them without granting any existing
-- conversation, project, execution, file, terminal, key, membership or admin path.
COMMENT ON TABLE chat_live_participants IS
  'Live-conversation participants; canonical ReBAC relations are collaboration_viewer/commenter/contributor.';

