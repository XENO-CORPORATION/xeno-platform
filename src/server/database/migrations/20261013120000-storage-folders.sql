-- UP
-- XENO Storage (codename Arca): FOLDERS. A folder belongs to one account and sits in another folder or at the
-- top (parent_id NULL). An item (a file, an artifact, a generation, an image) is in at most one folder; an item
-- with no row here is at the top. Additive: no existing table changes.
CREATE TABLE IF NOT EXISTS storage_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  parent_id uuid REFERENCES storage_folders(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- two folders in one place cannot share a name (compared without case); the top level is one place
CREATE UNIQUE INDEX IF NOT EXISTS storage_folders_name ON storage_folders (owner_user_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
CREATE INDEX IF NOT EXISTS storage_folders_parent ON storage_folders (owner_user_id, parent_id);
CREATE TABLE IF NOT EXISTS storage_item_folders (
  source text NOT NULL,
  source_id uuid NOT NULL,
  folder_id uuid NOT NULL REFERENCES storage_folders(id) ON DELETE RESTRICT,
  placed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, source_id)
);
CREATE INDEX IF NOT EXISTS storage_item_folders_folder ON storage_item_folders (folder_id);
-- DOWN
-- Retained deliberately: dropping these would lose how people organised their files.
