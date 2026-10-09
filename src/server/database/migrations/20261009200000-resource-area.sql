-- UP
-- AREA: the part of the workspace an item lives in (Studio, Office, Social, Corpo, Dev, Tools, or one
-- the person made). Owner's rule, 2026-10-03 and 2026-10-09: each area has its own chats, projects and
-- library; only Overview shows everything. One home per item: an item is in one area or in none.
--
-- NULL means "no area": the item shows on Overview only. Every row that exists today is NULL, so
-- nothing moves by itself. A conversation inside a project takes the PROJECT's area (read through the
-- project, never copied), so moving a project moves its chats.
--
-- This is NOT a workforce division (workforce_division_*): that is an org unit inside a company
-- workspace, owned by the workforce model. An area is a place in the left rail. Different things.
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS area TEXT;
ALTER TABLE chat_projects      ADD COLUMN IF NOT EXISTS area TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_conversations_area_shape') THEN
    ALTER TABLE chat_conversations ADD CONSTRAINT chat_conversations_area_shape CHECK (area IS NULL OR area ~ '^[a-z][a-z0-9_-]{0,39}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_projects_area_shape') THEN
    ALTER TABLE chat_projects ADD CONSTRAINT chat_projects_area_shape CHECK (area IS NULL OR area ~ '^[a-z][a-z0-9_-]{0,39}$');
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_chat_conversations_area ON chat_conversations (area) WHERE area IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_projects_area ON chat_projects (area) WHERE area IS NOT NULL;

-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM chat_conversations WHERE area IS NOT NULL) OR EXISTS (SELECT 1 FROM chat_projects WHERE area IS NOT NULL) THEN
    RAISE EXCEPTION 'resource-area rollback refused: items have been placed in an area, and dropping the column would lose where they live' USING ERRCODE='23514';
  END IF;
  DROP INDEX IF EXISTS idx_chat_conversations_area;
  DROP INDEX IF EXISTS idx_chat_projects_area;
  ALTER TABLE chat_conversations DROP CONSTRAINT IF EXISTS chat_conversations_area_shape;
  ALTER TABLE chat_projects DROP CONSTRAINT IF EXISTS chat_projects_area_shape;
  ALTER TABLE chat_conversations DROP COLUMN IF EXISTS area;
  ALTER TABLE chat_projects DROP COLUMN IF EXISTS area;
END $$;
