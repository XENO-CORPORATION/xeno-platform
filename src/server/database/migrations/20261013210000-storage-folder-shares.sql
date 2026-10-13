-- UP
-- XENO Storage (codename Arca): sharing a FOLDER, and "can edit".
-- A share now names a file OR a folder, and carries a role. storage_access is what the sharing service has
-- granted (worked out from the shares and the folder tree); it is compared against on every change so that
-- only the difference is written.
ALTER TABLE storage_shares ALTER COLUMN file_id DROP NOT NULL;
ALTER TABLE storage_shares ADD COLUMN IF NOT EXISTS folder_id uuid;
ALTER TABLE storage_shares ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'viewer';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storage_shares_one_target') THEN
    ALTER TABLE storage_shares ADD CONSTRAINT storage_shares_one_target CHECK ((file_id IS NOT NULL) <> (folder_id IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storage_shares_role') THEN
    ALTER TABLE storage_shares ADD CONSTRAINT storage_shares_role CHECK (role IN ('viewer', 'editor') AND (kind = 'person' OR role = 'viewer') AND (kind = 'person' OR folder_id IS NULL));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS storage_shares_folder_person ON storage_shares (folder_id, grantee_user_id) WHERE kind = 'person' AND revoked_at IS NULL AND folder_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS storage_access (
  kind text NOT NULL CHECK (kind IN ('file', 'folder')),
  target_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('viewer', 'editor')),
  owner_user_id uuid NOT NULL,
  PRIMARY KEY (kind, target_id, user_id)
);
CREATE INDEX IF NOT EXISTS storage_access_user ON storage_access (user_id, kind);
CREATE INDEX IF NOT EXISTS storage_access_owner ON storage_access (owner_user_id);
-- shares made before this migration granted a viewer tuple directly: record them so they are managed like the rest
INSERT INTO storage_access (kind, target_id, user_id, role, owner_user_id)
  SELECT 'file', file_id, grantee_user_id, 'viewer', owner_user_id FROM storage_shares
   WHERE kind = 'person' AND file_id IS NOT NULL AND revoked_at IS NULL ON CONFLICT DO NOTHING;
-- DOWN
-- Retained deliberately: these rows are who may open what.
