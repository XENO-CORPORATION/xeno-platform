-- UP
-- ============================================================
-- XENO Forum v0.2 — participation (votes, flags, reputation)
-- SPEC: "XENO FORUM - SPEC.md" §5.3, §7, §8. Decisions D4, D6.
--
-- v0.1 created the Record (spaces/threads/posts/tags). This adds the tables the
-- WRITE side needs. Two of them encode locked decisions in their shape, so a
-- later change has to argue with the schema rather than quietly drift:
--
--   forum_votes.voter_kind   — agent signals must stay separable FOREVER (D5),
--                              even if the account is later retyped or deleted,
--                              so the kind is stamped on the vote, not joined
--                              from the voter.
--   forum_reputation         — keyed (user_id, tag_id). There is deliberately NO
--                              global score column (D4): a single number is the
--                              scoreboard that turns knowledge into status.
-- ============================================================

-- ------------------------------------------------------------
-- votes — on threads or posts.
--
-- `weight` is STORED at cast time rather than computed at read time. Reputation
-- changes as answers get accepted; recomputing historic votes would silently
-- rewrite past decisions. What a vote was worth when it was cast is a fact.
--
-- D6: agent votes are advisory. They are recorded with is_binding = FALSE and
-- must never enter a quality score — surfacing only, never standing.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forum_votes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type  VARCHAR(8)  NOT NULL CHECK (target_type IN ('thread', 'post')),
  target_id    UUID        NOT NULL,
  voter_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  voter_kind   VARCHAR(8)  NOT NULL DEFAULT 'human'
               CHECK (voter_kind IN ('human', 'agent')),
  value        SMALLINT    NOT NULL CHECK (value IN (-1, 1)),
  weight       NUMERIC(4,2) NOT NULL DEFAULT 1.00 CHECK (weight >= 0 AND weight <= 3),
  is_binding   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One vote per voter per target. Changing your mind updates; it does not stack.
CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_votes_unique
  ON forum_votes(target_type, target_id, voter_id);
CREATE INDEX IF NOT EXISTS idx_forum_votes_target ON forum_votes(target_type, target_id);
-- The ranker reads binding and advisory signal separately; index the split.
CREATE INDEX IF NOT EXISTS idx_forum_votes_binding
  ON forum_votes(target_type, target_id) WHERE is_binding = TRUE;

-- ------------------------------------------------------------
-- flags — the moderation queue.
--
-- §7.2: agents may flag-to-REVIEW, never flag-to-remove. Nothing here removes
-- content; a flag only ever creates a row for a human to act on.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forum_flags (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type  VARCHAR(8)  NOT NULL CHECK (target_type IN ('thread', 'post')),
  target_id    UUID        NOT NULL,
  reporter_id  UUID        REFERENCES users(id) ON DELETE SET NULL,
  reporter_kind VARCHAR(8) NOT NULL DEFAULT 'human'
               CHECK (reporter_kind IN ('human', 'agent')),
  reason       VARCHAR(24) NOT NULL
               CHECK (reason IN ('spam', 'abuse', 'off_topic', 'duplicate', 'low_quality', 'other')),
  detail       TEXT,
  status       VARCHAR(16) NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'reviewing', 'actioned', 'dismissed')),
  resolved_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
  resolved_at  TIMESTAMPTZ,
  resolution   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One open flag per reporter per target — re-flagging is not a vote.
CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_flags_unique_open
  ON forum_flags(target_type, target_id, reporter_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_forum_flags_queue ON forum_flags(status, created_at);

-- ------------------------------------------------------------
-- reputation — PER TAG, derived, never rendered as a number (§7.1, D4).
--
-- Feeds two things: the ranker's quality term, and the capability ladder. It is
-- displayed only as earned capabilities and topic badges ("trusted in
-- xeno-canvas"), never as a leaderboard integer.
--
-- Derived, so it is safe to recompute from scratch at any time — the source of
-- truth is accepted answers, not this table.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forum_reputation (
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag_id            UUID NOT NULL REFERENCES forum_tags(id) ON DELETE CASCADE,
  accepted_answers  INTEGER NOT NULL DEFAULT 0,
  answers           INTEGER NOT NULL DEFAULT 0,
  score             NUMERIC(8,2) NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_forum_reputation_tag ON forum_reputation(tag_id, score DESC);

-- ------------------------------------------------------------
-- Cached vote tallies on the targets themselves, so a thread list does not
-- aggregate the whole vote table per row. Binding score only — advisory agent
-- signal is counted separately and never mixed in (D6).
-- ------------------------------------------------------------
ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS score NUMERIC(8,2) NOT NULL DEFAULT 0;
ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS advisory_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE forum_posts   ADD COLUMN IF NOT EXISTS score NUMERIC(8,2) NOT NULL DEFAULT 0;
ALTER TABLE forum_posts   ADD COLUMN IF NOT EXISTS advisory_count INTEGER NOT NULL DEFAULT 0;

-- Who last edited, for the moderation trail.
ALTER TABLE forum_posts   ADD COLUMN IF NOT EXISTS edited_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS locked_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

-- DOWN
DROP TABLE IF EXISTS forum_reputation;
DROP TABLE IF EXISTS forum_flags;
DROP TABLE IF EXISTS forum_votes;
ALTER TABLE forum_threads DROP COLUMN IF EXISTS score;
ALTER TABLE forum_threads DROP COLUMN IF EXISTS advisory_count;
ALTER TABLE forum_threads DROP COLUMN IF EXISTS locked_by;
ALTER TABLE forum_threads DROP COLUMN IF EXISTS locked_at;
ALTER TABLE forum_posts DROP COLUMN IF EXISTS score;
ALTER TABLE forum_posts DROP COLUMN IF EXISTS advisory_count;
ALTER TABLE forum_posts DROP COLUMN IF EXISTS edited_by;
