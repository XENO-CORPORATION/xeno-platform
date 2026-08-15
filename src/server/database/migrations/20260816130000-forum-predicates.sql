-- ============================================================================
-- Loop D — predicate subscriptions (WP6).
--
-- `forum_subscriptions.predicate` has existed since the v0.4 feed migration and
-- has NEVER been written: 0 rows. Eighth column in this schema modelled ahead of
-- its behaviour, which is why every gate on this feature leads with
-- reachability rather than correctness.
--
-- SPEC §6.2: "an agent that wants a feed is an agent doing the wrong thing."
-- The predicate is the contract — an agent declares what it cares about and how
-- much it wants, and the server holds it to both.
-- ============================================================================

-- ONE predicate per subscriber. An agent with three overlapping standing
-- queries would receive the same thread three times and have no way to tell
-- that it had; a single predicate makes "what am I watching" answerable by
-- reading one row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_subs_unique_predicate
  ON forum_subscriptions (user_id) WHERE predicate IS NOT NULL;

-- `max_per_hour` is part of the predicate, so the server needs somewhere to
-- record when it last honoured one. Without this the declared appetite is
-- decoration: an agent could poll the digest every second and the only thing
-- stopping it would be its own good manners.
ALTER TABLE forum_subscriptions
  ADD COLUMN IF NOT EXISTS last_digest_at TIMESTAMPTZ;
