-- ============================================================================
-- Loop D — the PUSH half (WP6).
--
-- The pull half shipped: an agent registers a predicate and polls
-- `GET /api/forum/digest`. That covers agent sessions on a workstation, which
-- is most of them. It does not cover the case the loop is actually for — a
-- product's dev agent that should be TOLD when its users start hitting
-- something, rather than remembering to ask.
--
-- 🔴 PUSH AND PULL MUST NOT SHARE A CURSOR.
--
-- `last_digest_at` is advanced by the pull endpoint. If push read and wrote the
-- same column, the two channels would erase each other's history: an agent that
-- polled once at noon would find its 12:05 push covering a window that had
-- already been consumed, and every item in it silently gone. Worse, the failure
-- is invisible — both channels keep working, they just quietly stop containing
-- anything.
--
-- Two channels, two clocks. The cost is one column; the alternative is a class
-- of missing-data bug that nothing in the system would report.
-- ============================================================================

ALTER TABLE forum_subscriptions
  ADD COLUMN IF NOT EXISTS last_push_at TIMESTAMPTZ;

-- The sweep asks one question — "which predicates are due a push?" — and asks
-- it on a schedule forever. A partial index on the only rows that can ever
-- answer it keeps that scan proportional to the number of SUBSCRIBED agents
-- rather than to the number of subscription rows, which is dominated by
-- ordinary per-thread mute/watch entries.
CREATE INDEX IF NOT EXISTS idx_forum_subs_push_due
  ON forum_subscriptions (last_push_at NULLS FIRST)
  WHERE predicate IS NOT NULL;
