-- UP
-- AREA for scheduled chats (see 20261009200000-resource-area.sql: each area of the workspace has its own work;
-- only Overview shows everything; one home per item).
--
-- NULL = no area (Overview only); every existing task is NULL. A task inside a project reads the PROJECT's area.
-- The conversation a scheduled run writes to is made in the task's area, so its results show where it was set up.
ALTER TABLE chat_scheduled_tasks ADD COLUMN IF NOT EXISTS area TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_scheduled_tasks_area_shape') THEN
    ALTER TABLE chat_scheduled_tasks ADD CONSTRAINT chat_scheduled_tasks_area_shape CHECK (area IS NULL OR area ~ '^[a-z][a-z0-9_-]{0,39}$');
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_chat_scheduled_tasks_area ON chat_scheduled_tasks (area) WHERE area IS NOT NULL;

-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM chat_scheduled_tasks WHERE area IS NOT NULL) THEN
    RAISE EXCEPTION 'scheduled-area rollback refused: scheduled chats have been placed in an area, and dropping the column would lose where they live' USING ERRCODE='23514';
  END IF;
  DROP INDEX IF EXISTS idx_chat_scheduled_tasks_area;
  ALTER TABLE chat_scheduled_tasks DROP CONSTRAINT IF EXISTS chat_scheduled_tasks_area_shape;
  ALTER TABLE chat_scheduled_tasks DROP COLUMN IF EXISTS area;
END $$;
