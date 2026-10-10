-- UP
-- Private reports (XENO REPORT - SPEC R2, R4; XENO FORUM - SPEC §12): a report the person chose to keep private is
-- a TICKET, never a private Forum thread. Only three readers: the reporter, XENO staff, and that product's own dev
-- agent (the agent account named "<product>-dev"). The reporter, and only the reporter, may make it public, which
-- creates a Feedback thread and links the two.
CREATE TABLE IF NOT EXISTS forum_tickets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_id     TEXT NOT NULL UNIQUE,
  reporter_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  product      TEXT NOT NULL CHECK (product ~ '^[a-z][a-z0-9-]{0,39}$'),
  kind         TEXT NOT NULL CHECK (kind IN ('bug', 'feature', 'feedback')),
  title        TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body         TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 20000),
  version      TEXT CHECK (version IS NULL OR version ~ '^[a-z0-9][a-z0-9._-]{0,30}$'),
  os           TEXT CHECK (os IS NULL OR length(os) <= 120),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'planned', 'fixed', 'wont_fix', 'closed')),
  fixed_in     TEXT CHECK (fixed_in IS NULL OR fixed_in ~ '^[a-z0-9][a-z0-9._-]{0,30}$'),
  thread_id    UUID REFERENCES forum_threads(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_forum_tickets_reporter ON forum_tickets(reporter_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_tickets_product ON forum_tickets(product, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS forum_ticket_posts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES forum_tickets(id) ON DELETE CASCADE,
  author_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('human', 'agent', 'service')),
  -- what the post is: words, or the record of a status change (so the history explains itself)
  kind        TEXT NOT NULL DEFAULT 'reply' CHECK (kind IN ('reply', 'status')),
  body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_forum_ticket_posts_ticket ON forum_ticket_posts(ticket_id, created_at);

-- the write-back: a ticket's reply or status change lands in the reporter's notifications
ALTER TABLE forum_notifications ADD COLUMN IF NOT EXISTS ticket_id UUID REFERENCES forum_tickets(id) ON DELETE CASCADE;
ALTER TABLE forum_notifications DROP CONSTRAINT IF EXISTS forum_notifications_kind_check;
ALTER TABLE forum_notifications ADD CONSTRAINT forum_notifications_kind_check CHECK (kind IN ('answer', 'reply', 'accepted', 'mention', 'ticket_reply', 'ticket_status'));

-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM forum_tickets) THEN
    RAISE EXCEPTION 'forum-tickets rollback refused: tickets exist, and dropping them would lose private reports' USING ERRCODE = '23514';
  END IF;
  DELETE FROM forum_notifications WHERE kind IN ('ticket_reply', 'ticket_status');
  ALTER TABLE forum_notifications DROP CONSTRAINT IF EXISTS forum_notifications_kind_check;
  ALTER TABLE forum_notifications ADD CONSTRAINT forum_notifications_kind_check CHECK (kind IN ('answer', 'reply', 'accepted', 'mention'));
  ALTER TABLE forum_notifications DROP COLUMN IF EXISTS ticket_id;
  DROP TABLE IF EXISTS forum_ticket_posts;
  DROP TABLE IF EXISTS forum_tickets;
END $$;
