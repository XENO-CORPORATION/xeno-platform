-- UP
-- VIEW-04: view switching preserves independent drafts/scroll state per
-- (user, view). States live in their own table keyed by user + view key --
-- never on the conversation row, so switching views cannot reparent a
-- session (there is no write path from here to chat_conversations at all).
CREATE TABLE IF NOT EXISTS user_view_states (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  view_key TEXT NOT NULL CHECK (view_key ~ '^[a-z]+(:[0-9a-f-]{36})?$'),
  draft TEXT NOT NULL DEFAULT '',
  scroll_offset INTEGER NOT NULL DEFAULT 0 CHECK (scroll_offset >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, view_key)
);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM user_view_states WHERE draft <> '' OR scroll_offset <> 0) THEN
    RAISE EXCEPTION 'view state rollback refused: states exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE user_view_states;
END $$;
