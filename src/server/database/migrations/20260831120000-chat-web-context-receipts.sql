-- UP
-- Web Context provenance is server-owned. The browser receives an opaque receipt
-- and can consume it exactly once when persisting the corresponding assistant
-- message; it never writes authoritative search_context JSON directly.
CREATE TABLE IF NOT EXISTS chat_web_context_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  query_hash TEXT NOT NULL CHECK (query_hash ~ '^[a-f0-9]{64}$'),
  search_context JSONB NOT NULL,
  consumed_message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 minutes'),
  CHECK (jsonb_typeof(search_context) = 'object'),
  CHECK (search_context->>'schema' = 'xeno.chat.web-context.v1')
);

CREATE INDEX IF NOT EXISTS idx_chat_web_context_receipts_consume
  ON chat_web_context_receipts(id, conversation_id, user_id)
  WHERE consumed_message_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_chat_web_context_receipts_expiry
  ON chat_web_context_receipts(expires_at)
  WHERE consumed_message_id IS NULL;

COMMENT ON TABLE chat_web_context_receipts IS
  'Short-lived server-owned Web Context provenance receipts consumed atomically by assistant message persistence.';
