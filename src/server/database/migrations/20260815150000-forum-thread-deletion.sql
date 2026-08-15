-- ============================================================================
-- Thread deletion (WP2, remainder).
--
-- `forum_threads.status` allowed open / resolved / duplicate / locked /
-- archived. Deleting a thread had no representable state, which is why post
-- deletion refused position 1 with `cannot_delete_first_post`.
--
-- 🔴 THE DANGEROUS PART IS NOT THIS FILE, IT IS THE READ SIDE.
--
-- Every thread read filters `t.status <> 'archived'` — a blocklist of exactly
-- one value, in four separate places. Adding 'deleted' to this CHECK without
-- changing all four would produce deleted threads that are still listed
-- everywhere, on a feature whose entire purpose is that they are not.
--
-- The reads are updated in the same change (forumService.js), and a gate
-- asserts no read path still uses the bare `<> 'archived'` form, because
-- "remember to update the other three" is not a mechanism.
-- ============================================================================

ALTER TABLE forum_threads DROP CONSTRAINT IF EXISTS forum_threads_status_check;

ALTER TABLE forum_threads ADD CONSTRAINT forum_threads_status_check
  CHECK (status IN ('open', 'resolved', 'duplicate', 'locked', 'archived', 'deleted'));

-- Threads had no deletion audit columns at all (posts got theirs in
-- 20260815140000). SET NULL on deleted_by for the same reason as there: if the
-- moderator who removed something later leaves, the deletion is still a fact
-- that happened, and cascading would erase the audit trail as a side effect of
-- an unrelated account closure.
ALTER TABLE forum_threads
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- The moderation log reads "what was removed, recently".
CREATE INDEX IF NOT EXISTS idx_forum_threads_deleted
  ON forum_threads (deleted_at DESC) WHERE deleted_at IS NOT NULL;
