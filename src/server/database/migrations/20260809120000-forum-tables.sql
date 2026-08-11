-- UP
-- ============================================================
-- XENO Forum — the community surface (the "Record")
-- SPEC: "XENO FORUM - SPEC.md" §8 (data model). Decisions D1-D13.
--
-- Reuse map (verified against the codebase, do NOT reinvent):
--   - Identity: users(id) + the handle registry (routes/handleRoutes.js)
--   - Trust/staff: marketplace_developers.trust_tier  (no second trust concept)
--   - Conventions copied from 20260619120000-marketplace-tables.sql:
--       UUID PKs, TIMESTAMPTZ, CHECK-constrained enums, IF NOT EXISTS,
--       seeds in a separate re-runnable script (database/seeds/forum-seed.js).
--
-- SCOPE: this migration creates the full Record model (spaces/threads/posts/
-- tags). v0.1 exposes it READ-ONLY; the write columns (accepted_at, resolved_by,
-- duplicate_of, promoted_to) are created now so v0.2-v0.4 add behaviour, not
-- columns.
--
-- NOT HERE, deliberately: the agent-identity primitive (SPEC D8 —
-- users.kind + users.owner_user_id). That is a PLATFORM primitive shared with
-- Marketplace / Company / Comms, and whoever builds it first owns it. The Forum
-- records author_kind on each row so agent-authored content stays separable
-- forever, but it does not define the identity model.
-- ============================================================

-- ------------------------------------------------------------
-- spaces — top-level sections. `kind` drives MECHANICS, not just the label
-- (SPEC §2.1): only `qa` has accepted answers; only `feedback` is promotable.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forum_spaces (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         VARCHAR(80)  NOT NULL,
  name         VARCHAR(120) NOT NULL,
  description  TEXT,
  kind         VARCHAR(16)  NOT NULL
               CHECK (kind IN ('qa', 'discussion', 'showcase', 'feedback', 'announcement')),
  -- staff-post-only (announcement spaces); replies may still be allowed
  post_policy  VARCHAR(16)  NOT NULL DEFAULT 'open'
               CHECK (post_policy IN ('open', 'staff_only')),
  position     INTEGER      NOT NULL DEFAULT 0,
  status       VARCHAR(16)  NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'archived', 'hidden')),
  thread_count INTEGER      NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_spaces_slug ON forum_spaces(slug);
CREATE INDEX IF NOT EXISTS idx_forum_spaces_status ON forum_spaces(status, position);

-- ------------------------------------------------------------
-- threads — the unit of the Record.
--
-- short_id is the CITABLE id (SPEC D9): permanent, never reused, survives a
-- retitle. Permalinks are /forum/t/<short_id>/<slug> — the slug is decorative,
-- the short_id resolves.
--
-- author_kind is recorded ON THE ROW rather than joined from the author, so
-- that (a) agent-authored content stays separable even if an account is later
-- retyped or deleted, and (b) seeded/system content is honest about its origin.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forum_threads (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_id         VARCHAR(12)  NOT NULL,
  space_id         UUID         NOT NULL REFERENCES forum_spaces(id) ON DELETE CASCADE,
  slug             VARCHAR(200) NOT NULL,
  title            VARCHAR(300) NOT NULL,

  author_id        UUID         REFERENCES users(id) ON DELETE SET NULL,
  author_kind      VARCHAR(8)   NOT NULL DEFAULT 'human'
                   CHECK (author_kind IN ('human', 'agent', 'system')),

  status           VARCHAR(16)  NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'resolved', 'duplicate', 'locked', 'archived')),
  duplicate_of     UUID         REFERENCES forum_threads(id) ON DELETE SET NULL,

  -- §7.3 escape hatches. Typed target string, e.g. 'docs:canvas/booleans',
  -- 'issue:gh#123'. XENO Telos does not exist yet (CATALOG §3 gap #1) — this is
  -- the seam, wired when it lands.
  promoted_to      TEXT,

  answer_post_id   UUID,                 -- FK added after forum_posts exists
  resolved_at      TIMESTAMPTZ,
  resolved_by      UUID         REFERENCES users(id) ON DELETE SET NULL,

  post_count       INTEGER      NOT NULL DEFAULT 0,
  -- The Record's default sort. NOT a ranking signal — recency may only break
  -- ties in the Feed (SPEC §5.4 forbidden signals).
  last_activity_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Provenance for seeded content, so the archive never pretends to be
  -- organic. NULL for genuine user posts.
  source           VARCHAR(64),

  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_threads_short_id ON forum_threads(short_id);
CREATE INDEX IF NOT EXISTS idx_forum_threads_space   ON forum_threads(space_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_threads_status  ON forum_threads(status);
CREATE INDEX IF NOT EXISTS idx_forum_threads_author  ON forum_threads(author_id);
CREATE INDEX IF NOT EXISTS idx_forum_threads_activity ON forum_threads(last_activity_at DESC);
-- Unresolved-and-aging is the Feed's primary need signal (SPEC §5.2): an
-- unanswered thread GAINS urgency with age. Index the exact shape it queries.
CREATE INDEX IF NOT EXISTS idx_forum_threads_unresolved
  ON forum_threads(status, created_at)
  WHERE status = 'open' AND answer_post_id IS NULL;

-- ------------------------------------------------------------
-- posts — messages. position 1 is the thread body.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forum_posts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id    UUID        NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  position     INTEGER     NOT NULL,
  body         TEXT        NOT NULL,      -- markdown; rendered sanitized, NEVER raw HTML (SPEC §11)

  author_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
  author_kind  VARCHAR(8)  NOT NULL DEFAULT 'human'
               CHECK (author_kind IN ('human', 'agent', 'system')),

  is_answer    BOOLEAN     NOT NULL DEFAULT FALSE,
  accepted_at  TIMESTAMPTZ,
  -- D6: agents propose, humans ratify. Only a human may fill accepted_by.
  accepted_by  UUID        REFERENCES users(id) ON DELETE SET NULL,

  status       VARCHAR(16) NOT NULL DEFAULT 'visible'
               CHECK (status IN ('visible', 'hidden', 'deleted')),
  edited_at    TIMESTAMPTZ,
  source       VARCHAR(64),

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_posts_thread_position ON forum_posts(thread_id, position);
CREATE INDEX IF NOT EXISTS idx_forum_posts_thread  ON forum_posts(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_forum_posts_author  ON forum_posts(author_id);
CREATE INDEX IF NOT EXISTS idx_forum_posts_answers ON forum_posts(thread_id) WHERE is_answer = TRUE;

-- The accepted answer must be a post in this thread. Added after both tables
-- exist because the reference is circular.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_forum_threads_answer_post'
  ) THEN
    ALTER TABLE forum_threads
      ADD CONSTRAINT fk_forum_threads_answer_post
      FOREIGN KEY (answer_post_id) REFERENCES forum_posts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ------------------------------------------------------------
-- tags — NAMESPACED, which is what makes them machine-usable (SPEC §2.2).
-- The namespace is the join key for the ranker's fit calculation, the
-- product-page widget, agent subscription predicates, and the release loop.
-- A flat tag cloud buys none of that.
--   product:<slug>  → resolves against the real product catalog
--   version:<semver>→ enables "fixed in 0.37.0" / stale-thread detection
--   topic:<free>    → curated vocabulary
--   kind:<bug|howto|idea|discussion>
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forum_tags (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace    VARCHAR(16) NOT NULL
               CHECK (namespace IN ('product', 'version', 'topic', 'kind')),
  value        VARCHAR(80) NOT NULL,
  description  TEXT,
  thread_count INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_tags_ns_value ON forum_tags(namespace, value);
CREATE INDEX IF NOT EXISTS idx_forum_tags_namespace ON forum_tags(namespace, thread_count DESC);

CREATE TABLE IF NOT EXISTS forum_thread_tags (
  thread_id  UUID NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  tag_id     UUID NOT NULL REFERENCES forum_tags(id)    ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (thread_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_forum_thread_tags_tag ON forum_thread_tags(tag_id);

-- ------------------------------------------------------------
-- Lexical search (SPEC §5.1). Exact error strings must match exactly — that
-- is what people actually paste. Semantic search (pgvector + xeno-rt
-- embeddings) fuses in at v0.4; this is the half that must never regress.
--
-- Generated columns can only reference their own row, so thread titles and
-- post bodies carry separate vectors and the query fuses them.
-- ------------------------------------------------------------
ALTER TABLE forum_threads
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, ''))) STORED;

ALTER TABLE forum_posts
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(body, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_forum_threads_search ON forum_threads USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_forum_posts_search   ON forum_posts   USING gin(search_vector);

-- DOWN
DROP TABLE IF EXISTS forum_thread_tags;
DROP TABLE IF EXISTS forum_tags;
DROP TABLE IF EXISTS forum_posts CASCADE;
DROP TABLE IF EXISTS forum_threads CASCADE;
DROP TABLE IF EXISTS forum_spaces;
