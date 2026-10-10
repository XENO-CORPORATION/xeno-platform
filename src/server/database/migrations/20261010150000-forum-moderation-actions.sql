-- UP
-- The PUBLIC moderation log as an append-only record of decisions (XENO FORUM - SPEC §7.2).
--
-- Until now the log was rebuilt from each target's CURRENT status, so unlocking a thread or restoring a post
-- silently rewrote what the log said had happened. A log that changes after the fact is not a log. Each row here
-- is one moderator decision, written once and never updated.
--
-- Actions: hide / restore (a post), lock / unlock / duplicate (a thread). `reason` reuses the flag categories.
CREATE TABLE IF NOT EXISTS forum_moderation_actions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action        TEXT NOT NULL CHECK (action IN ('hide', 'restore', 'lock', 'unlock', 'duplicate')),
  target_type   TEXT NOT NULL CHECK (target_type IN ('thread', 'post')),
  target_id     UUID NOT NULL,
  thread_id     UUID REFERENCES forum_threads(id) ON DELETE SET NULL,
  duplicate_of  UUID REFERENCES forum_threads(id) ON DELETE SET NULL,
  moderator_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  reason        TEXT CHECK (reason IS NULL OR reason IN ('spam', 'abuse', 'off_topic', 'duplicate', 'low_quality', 'other')),
  note          TEXT CHECK (note IS NULL OR length(note) <= 1000),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((action IN ('hide', 'restore') AND target_type = 'post') OR (action IN ('lock', 'unlock', 'duplicate') AND target_type = 'thread')),
  CHECK ((action = 'duplicate') = (duplicate_of IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_forum_moderation_actions_at ON forum_moderation_actions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_moderation_actions_target ON forum_moderation_actions(target_type, target_id);

-- carry the decisions already taken into the record, once: one row per actioned target
INSERT INTO forum_moderation_actions (action, target_type, target_id, thread_id, moderator_id, reason, created_at)
SELECT DISTINCT ON (f.target_type, f.target_id)
       CASE WHEN f.target_type = 'post' THEN 'hide' ELSE 'lock' END, f.target_type, f.target_id,
       CASE WHEN f.target_type = 'post' THEN (SELECT p.thread_id FROM forum_posts p WHERE p.id = f.target_id) ELSE f.target_id END,
       f.resolved_by, f.reason, COALESCE(f.resolved_at, now())
  FROM forum_flags f
 WHERE f.status = 'actioned'
   AND NOT EXISTS (SELECT 1 FROM forum_moderation_actions a WHERE a.target_type = f.target_type AND a.target_id = f.target_id)
 ORDER BY f.target_type, f.target_id, f.resolved_at;

-- DOWN
DROP TABLE IF EXISTS forum_moderation_actions;
