-- UP
-- XENO Tasks, human collaboration (xeno-tasks/SPEC.md §4): sub-tasks, links between tasks, watchers, editable
-- comments, readable history, saved views and due reminders; and ONE notification store for the person's inbox.
--
-- user_notifications is the platform's inbox, not a Tasks table: `source` names the product that wrote the row, so
-- every product can add its own without a new table. (The Forum keeps forum_notifications for now; it already has its
-- own mail sweep and callers.) Read and emailed are separate clocks, as in forum_notifications.

-- sub-tasks: a task may have one parent in the same place (same project, or the same personal owner)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES tasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id) WHERE parent_id IS NOT NULL;
-- due reminders are sent once per due date: the date they were sent for is remembered, so moving the date re-arms them
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_soon_sent_for TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS overdue_sent_for TIMESTAMPTZ;

-- links: one row per relation; `blocks` and `duplicates` read in both directions, `relates` is symmetric
CREATE TABLE IF NOT EXISTS task_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_task   UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  to_task     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('blocks', 'relates', 'duplicates')),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_task <> to_task),
  UNIQUE (from_task, to_task, kind)
);
CREATE INDEX IF NOT EXISTS idx_task_links_to ON task_links(to_task);

-- watchers: who hears about a task. Reporter, assignee, reviewer, commenters and the mentioned are added automatically;
-- anyone who can see the task may watch or stop watching (muted keeps an automatic watcher from coming back).
CREATE TABLE IF NOT EXISTS task_watchers (
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muted       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_task_watchers_user ON task_watchers(user_id);

-- history with values: an edit records which field changed and from what to what
ALTER TABLE task_events ADD COLUMN IF NOT EXISTS field TEXT CHECK (field IS NULL OR length(field) <= 40);
-- comments can be edited and removed by their author; the row stays so the thread keeps its shape
ALTER TABLE task_events ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE task_events ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;
ALTER TABLE task_events DROP CONSTRAINT IF EXISTS task_events_kind_check;
ALTER TABLE task_events ADD CONSTRAINT task_events_kind_check CHECK (kind IN ('created', 'edited', 'status', 'assigned', 'claimed', 'comment', 'attached', 'detached', 'deleted', 'restored', 'linked', 'unlinked', 'parent'));

-- saved views: a named set of board filters, the person's own
CREATE TABLE IF NOT EXISTS task_views (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  area        TEXT CHECK (area IS NULL OR area ~ '^[a-z][a-z0-9_-]{0,39}$'),
  filters     JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(filters) = 'object' AND length(filters::text) <= 4000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_views_user ON task_views(user_id, created_at);

CREATE TABLE IF NOT EXISTS user_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,          -- the recipient
  source      TEXT NOT NULL CHECK (source ~ '^[a-z][a-z0-9_-]{0,31}$'),       -- the product: 'tasks', …
  kind        TEXT NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]{0,39}$'),
  ref         TEXT NOT NULL CHECK (length(ref) <= 200),                      -- what it is about, e.g. T-12
  title       TEXT NOT NULL CHECK (length(title) <= 400),
  detail      TEXT NOT NULL DEFAULT '' CHECK (length(detail) <= 1000),
  area        TEXT CHECK (area IS NULL OR area ~ '^[a-z][a-z0-9_-]{0,39}$'),
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_kind  TEXT CHECK (actor_kind IS NULL OR actor_kind IN ('human', 'agent', 'service')),
  read_at     TIMESTAMPTZ,
  emailed_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_notifs_unread ON user_notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_notifs_user ON user_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_notifs_unemailed ON user_notifications(created_at) WHERE emailed_at IS NULL AND read_at IS NULL;

-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM user_notifications) OR EXISTS (SELECT 1 FROM task_links) OR EXISTS (SELECT 1 FROM task_views)
     OR EXISTS (SELECT 1 FROM tasks WHERE parent_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM task_events WHERE kind IN ('restored', 'linked', 'unlinked', 'parent') OR edited_at IS NOT NULL OR removed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'xeno-tasks collaboration rollback refused: its data exists' USING ERRCODE = '23514';
  END IF;
  DROP TABLE IF EXISTS user_notifications;
  DROP TABLE IF EXISTS task_views;
  DROP TABLE IF EXISTS task_watchers;
  DROP TABLE IF EXISTS task_links;
  ALTER TABLE task_events DROP CONSTRAINT IF EXISTS task_events_kind_check;
  ALTER TABLE task_events ADD CONSTRAINT task_events_kind_check CHECK (kind IN ('created', 'edited', 'status', 'assigned', 'claimed', 'comment', 'attached', 'detached', 'deleted'));
  ALTER TABLE task_events DROP COLUMN IF EXISTS removed_at;
  ALTER TABLE task_events DROP COLUMN IF EXISTS edited_at;
  ALTER TABLE task_events DROP COLUMN IF EXISTS field;
  ALTER TABLE tasks DROP COLUMN IF EXISTS overdue_sent_for;
  ALTER TABLE tasks DROP COLUMN IF EXISTS due_soon_sent_for;
  ALTER TABLE tasks DROP COLUMN IF EXISTS parent_id;
END $$;
