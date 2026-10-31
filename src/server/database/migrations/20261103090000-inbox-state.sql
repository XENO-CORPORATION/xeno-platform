-- The inbox's state belongs to the person, not to one browser: archive and snooze were kept in localStorage, so they did
-- not follow anyone to another device and a snoozed row never woke. Snooze is a time and waking is derived from it, so no
-- sweep can forget. dedupe_key lets a writer that may run twice (a sweep on two replicas, a retried run) write one row.
ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ;
ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS dedupe_key TEXT CHECK (dedupe_key IS NULL OR length(dedupe_key) <= 200);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_notifs_dedupe ON user_notifications(user_id, source, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_notifs_live ON user_notifications(user_id, created_at DESC) WHERE archived_at IS NULL;

-- DOWN
DROP INDEX IF EXISTS idx_user_notifs_live;
DROP INDEX IF EXISTS idx_user_notifs_dedupe;
ALTER TABLE user_notifications DROP COLUMN IF EXISTS dedupe_key;
ALTER TABLE user_notifications DROP COLUMN IF EXISTS snoozed_until;
ALTER TABLE user_notifications DROP COLUMN IF EXISTS archived_at;
