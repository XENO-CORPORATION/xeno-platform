-- UP
-- XENO Storage (codename Arca): TEAM FOLDERS. A folder may belong to a workspace instead of one person; every
-- member sees it. The scope is set on the top folder and inherited below it.
ALTER TABLE storage_folders ADD COLUMN IF NOT EXISTS workspace_id uuid;
-- names are unique per place: a person's own folders, and a workspace's folders, each in their own space
DROP INDEX IF EXISTS storage_folders_name;
CREATE UNIQUE INDEX IF NOT EXISTS storage_folders_name_personal ON storage_folders (owner_user_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) WHERE workspace_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS storage_folders_name_team ON storage_folders (workspace_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS storage_folders_workspace ON storage_folders (workspace_id, parent_id) WHERE workspace_id IS NOT NULL;
-- DOWN
-- Retained deliberately: dropping the column would turn a team's folders into one member's private ones.
