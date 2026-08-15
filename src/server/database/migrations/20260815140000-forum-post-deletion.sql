-- ============================================================================
-- Post deletion audit columns (WP2).
--
-- `forum_posts.status` has allowed 'deleted' since the first migration and
-- nothing ever set it; `edited_at` and `edited_by` likewise, with `edited_at`
-- already serialized by forumService and typed in ForumThread.tsx. The read
-- side was complete top to bottom and the write side did not exist — the sixth
-- instance of that shape in this codebase.
--
-- What was genuinely missing is WHO deleted a post and WHEN. Without it a
-- tombstone cannot be told apart from a moderator action, which is the one
-- distinction a public moderation log (§7.2) has to make.
-- ============================================================================

ALTER TABLE forum_posts
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  -- SET NULL rather than CASCADE: if the moderator who removed something later
  -- leaves, the deletion is still a fact that happened. Cascading would erase
  -- the audit trail as a side effect of an unrelated account closure.
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- The moderation log reads "what was removed, recently" — never "is this one
-- post deleted", which the row already answers. Partial, because tombstones
-- will always be a small minority of posts.
CREATE INDEX IF NOT EXISTS idx_forum_posts_deleted
  ON forum_posts (deleted_at DESC) WHERE deleted_at IS NOT NULL;

-- NOTE for whoever wires GDPR erasure (WP2's remaining half):
-- `search_vector` is GENERATED ALWAYS from `body`, so blanking the body removes
-- the post from the full-text index automatically — no separate reindex, and no
-- way to forget. Deleting the ROW instead would renumber positions and orphan
-- the replies that quote it, which is why deletion is a tombstone plus an empty
-- body rather than a DELETE.
