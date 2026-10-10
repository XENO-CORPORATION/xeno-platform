-- UP
-- XENO Tasks: images on a task, and deleting a task (xeno-tasks/SPEC.md §4).
--
-- Images live in Postgres beside the task (bytea, at most 8 MB each and 20 per task), so they inherit the task's
-- visibility exactly, are in every database backup, and need no second storage system to keep in step. The type is
-- decided from the file's own signature, never from the name or the uploader's header.
-- A deleted task keeps its row (deleted_at): its key is never reused and its history stays for anyone auditing it.
CREATE TABLE IF NOT EXISTS task_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  uploader_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  filename     TEXT NOT NULL CHECK (length(filename) BETWEEN 1 AND 200),
  mime         TEXT NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  size_bytes   INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 8388608),
  data         BYTEA NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id, created_at);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE task_events DROP CONSTRAINT IF EXISTS task_events_kind_check;
ALTER TABLE task_events ADD CONSTRAINT task_events_kind_check CHECK (kind IN ('created', 'edited', 'status', 'assigned', 'claimed', 'comment', 'attached', 'detached', 'deleted'));

-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM task_attachments) OR EXISTS (SELECT 1 FROM tasks WHERE deleted_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM task_events WHERE kind IN ('attached', 'detached', 'deleted')) THEN
    RAISE EXCEPTION 'xeno-tasks attachments rollback refused: attachments or deleted tasks exist' USING ERRCODE = '23514';
  END IF;
  DROP TABLE IF EXISTS task_attachments;
  ALTER TABLE tasks DROP COLUMN IF EXISTS deleted_at;
  ALTER TABLE task_events DROP CONSTRAINT IF EXISTS task_events_kind_check;
  ALTER TABLE task_events ADD CONSTRAINT task_events_kind_check CHECK (kind IN ('created', 'edited', 'status', 'assigned', 'claimed', 'comment'));
END $$;
