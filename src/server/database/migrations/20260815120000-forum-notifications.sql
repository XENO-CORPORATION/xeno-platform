-- ============================================================================
-- forum_notifications — WP1. The return path.
--
-- Until this table exists, the Forum is write-only from the user's point of
-- view: you ask a question, somebody answers it, and you are never told. Loop A
-- in `XENO FORUM - v1.0 RELEASE PLAN.md` cannot close without this, and a loop
-- that does not close is worse than absent — people put effort in, get nothing
-- back, and only learn that once.
--
-- Conventions from 20260619120000-marketplace-tables.sql: UUID PKs, TIMESTAMPTZ,
-- CHECK-constrained enums, CREATE TABLE IF NOT EXISTS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS forum_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The RECIPIENT. Cascades: deleting an account removes what it was owed.
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  kind        TEXT NOT NULL CHECK (kind IN ('answer', 'reply', 'accepted', 'mention')),

  thread_id   UUID REFERENCES forum_threads(id) ON DELETE CASCADE,
  post_id     UUID REFERENCES forum_posts(id)   ON DELETE CASCADE,

  -- WHO caused it. ON DELETE SET NULL, not CASCADE, and the difference matters:
  -- if the person who answered you later deletes their account, you should not
  -- silently lose the notification that you HAVE an answer. The event survives;
  -- the attribution anonymises. Cascading here would delete history that is not
  -- the departing user's to take with them.
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_kind  TEXT,

  -- Read state and email state are SEPARATE clocks. A notification can be
  -- emailed and unread (the normal case), or read and never emailed (they were
  -- on the site when it happened, so mailing them would be noise).
  read_at     TIMESTAMPTZ,
  emailed_at  TIMESTAMPTZ,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The unread badge is the single hottest query in the product: it runs on every
-- page load for every signed-in user. Partial index — read rows are dead weight
-- for this lookup and there will eventually be far more of them than unread.
CREATE INDEX IF NOT EXISTS idx_forum_notifs_unread
  ON forum_notifications (user_id, created_at DESC) WHERE read_at IS NULL;

-- The full list, read or not.
CREATE INDEX IF NOT EXISTS idx_forum_notifs_user
  ON forum_notifications (user_id, created_at DESC);

-- Claimed by the email sender so a crash mid-batch cannot double-send.
CREATE INDEX IF NOT EXISTS idx_forum_notifs_unemailed
  ON forum_notifications (created_at) WHERE emailed_at IS NULL AND read_at IS NULL;

-- An answer can be accepted, unaccepted and re-accepted. Without this the author
-- collects a new "your answer was accepted" every time somebody toggles it —
-- which is how a notification system teaches people to ignore it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_notifs_one_accept
  ON forum_notifications (user_id, post_id) WHERE kind = 'accepted';
