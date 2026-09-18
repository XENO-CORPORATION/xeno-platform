-- chat_messages becomes a TREE: an edit or a regenerate is a sibling branch, never an overwrite.
--
-- WHY
-- ---
-- Editing a message only changed it on screen. The resend appended a NEW assistant reply to the
-- flat list; the edited text was never saved and the old reply never retired — after a reload a
-- person saw the original message with two answers under it (production, 2026-09-18, conversation
-- 013aed12…, messages 19 and 20). ChatGPT and Claude solve this the same way: each user message
-- can have several versions, each version its own reply chain, and the bubble shows ‹ 1/2 › to
-- move between them. Nothing is lost and every branch is persisted. Regenerate is the same
-- primitive under an assistant message.
--
-- WHAT
-- ----
-- `chat_messages.parent_id` — the message this one follows (NULL = the conversation's first).
-- `chat_conversations.active_leaf_id` — the message the person is looking at; the branch shown
-- is the path from it to the root. Existing rows are chained by `message_index`, so every
-- current conversation is one straight branch and its leaf is its last message.
-- `message_index` stays: it is creation order and still the tie-breaker among siblings.

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES chat_messages(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_chat_messages_parent ON chat_messages(parent_id);
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS active_leaf_id UUID;

-- one straight branch per existing conversation
UPDATE chat_messages m
   SET parent_id = p.prev_id
  FROM (
    SELECT id, LAG(id) OVER (PARTITION BY conversation_id ORDER BY message_index, created_at) AS prev_id
      FROM chat_messages
  ) p
 WHERE m.id = p.id AND m.parent_id IS NULL AND p.prev_id IS NOT NULL;

UPDATE chat_conversations c
   SET active_leaf_id = l.id
  FROM (
    SELECT DISTINCT ON (conversation_id) conversation_id, id
      FROM chat_messages
     ORDER BY conversation_id, message_index DESC, created_at DESC
  ) l
 WHERE c.id = l.conversation_id AND c.active_leaf_id IS NULL;
