-- UP
-- A person's pinned conversations (the sidebar's "Pinned" block), the same shape as chat_project_pins.
-- A pin is a user preference: a shared conversation is pinned by each person who wants it.
CREATE TABLE IF NOT EXISTS chat_conversation_pins (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, conversation_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_conversation_pins_user_position ON chat_conversation_pins(user_id, position);
CREATE INDEX IF NOT EXISTS idx_chat_conversation_pins_conversation ON chat_conversation_pins(conversation_id);

-- DOWN
DROP TABLE IF EXISTS chat_conversation_pins;
