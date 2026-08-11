-- UP
-- ============================================================
-- XENO Forum v0.4 — the Feed
-- SPEC: "XENO FORUM - SPEC.md" §5.2, §5.5, §5.6. Decisions D2, D3, D11.
--
-- The Record (v0.1) is unranked and permanent. The Feed is ranked and personal.
-- Two surfaces over ONE corpus — no second copy of anything.
--
-- These two tables exist so the ranker can do things a feed normally refuses to:
--   forum_impressions   — so it can STOP showing you what you keep ignoring, and
--                         so any placement can be explained after the fact.
--   forum_subscriptions — an explicit "I care about this", which is a far better
--                         signal than inferring interest from what you clicked.
-- ============================================================

-- ------------------------------------------------------------
-- impressions — what the Feed showed you, and WHY.
--
-- Two jobs, both unusual:
--
-- 1. SEEN-DECAY. An item shown repeatedly without being opened decays FOR YOU.
--    An engagement-maximising feed does the opposite — it re-serves what you
--    ignored, because ignoring is not clicking and clicking is the target. Here
--    the system takes the hint.
--
-- 2. AUDITABILITY (D11). `reason_codes` records why an item was placed, so
--    "why did I see this?" is answerable for any user on any day. A ranker whose
--    decisions cannot be reconstructed is one nobody can hold to its objective.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forum_impressions (
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id    UUID        NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  shown_count  INTEGER     NOT NULL DEFAULT 1,
  opened       BOOLEAN     NOT NULL DEFAULT FALSE,
  reason_codes TEXT[]      NOT NULL DEFAULT '{}',
  ranker       VARCHAR(32),
  first_shown  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_shown   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, thread_id)
);

CREATE INDEX IF NOT EXISTS idx_forum_impressions_user ON forum_impressions(user_id, last_shown DESC);

-- ------------------------------------------------------------
-- subscriptions — an explicit "I care about this".
--
-- `predicate` carries an agent's standing query (§6.2) — agents subscribe rather
-- than scroll, so the same table serves both without a second concept. A human
-- row sets `tag_id` or `space_id`; an agent row sets `predicate`.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forum_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag_id     UUID        REFERENCES forum_tags(id) ON DELETE CASCADE,
  space_id   UUID        REFERENCES forum_spaces(id) ON DELETE CASCADE,
  thread_id  UUID        REFERENCES forum_threads(id) ON DELETE CASCADE,
  predicate  JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A subscription must actually point at something.
  CONSTRAINT subscription_has_a_target
    CHECK (tag_id IS NOT NULL OR space_id IS NOT NULL OR thread_id IS NOT NULL OR predicate IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_forum_subs_user ON forum_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_forum_subs_tag ON forum_subscriptions(tag_id) WHERE tag_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_subs_unique_tag
  ON forum_subscriptions(user_id, tag_id) WHERE tag_id IS NOT NULL;

-- ------------------------------------------------------------
-- Distinct-reporter count for `feedback` threads.
--
-- §5.2: feedback need scales with how many DIFFERENT people hit it, never with
-- how loud the thread got. Cached here so the Feed does not aggregate per row.
-- ------------------------------------------------------------
ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS distinct_participants INTEGER NOT NULL DEFAULT 0;

-- DOWN
DROP TABLE IF EXISTS forum_impressions;
DROP TABLE IF EXISTS forum_subscriptions;
ALTER TABLE forum_threads DROP COLUMN IF EXISTS distinct_participants;
