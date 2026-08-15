-- ============================================================================
-- Thread subscriptions — the mute half of "someone replied" (WP1).
--
-- `forum_subscriptions.thread_id` has existed since the v0.4 feed migration and
-- nothing has ever written it. Wiring reply fan-out without also wiring the way
-- OUT of it is how a forum becomes the thing people mute at the mail client
-- instead of in the product — and once they do that, no notification works
-- again.
-- ============================================================================

-- Posting in a thread subscribes you to it, so this has to be idempotent at the
-- database rather than by a read-then-write check in the service. The tag
-- equivalent (idx_forum_subs_unique_tag) already exists; threads never got one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_subs_unique_thread
  ON forum_subscriptions (user_id, thread_id) WHERE thread_id IS NOT NULL;

-- 🔴 MUTE IS A FLAG, NOT A DELETED ROW.
--
-- If unsubscribing removed the row, the next post you made in that thread would
-- silently re-subscribe you — the auto-subscribe cannot tell "never subscribed"
-- from "asked to stop". An explicit no must survive a later implicit yes.
--
-- Same principle as `email_opt_outs` being keyed by email rather than user_id:
-- the record of someone declining is more durable than the thing that created
-- it.
ALTER TABLE forum_subscriptions
  ADD COLUMN IF NOT EXISTS muted BOOLEAN NOT NULL DEFAULT FALSE;

-- The fan-out query: everyone watching this thread who has not muted it.
CREATE INDEX IF NOT EXISTS idx_forum_subs_thread_active
  ON forum_subscriptions (thread_id) WHERE thread_id IS NOT NULL AND muted = FALSE;
