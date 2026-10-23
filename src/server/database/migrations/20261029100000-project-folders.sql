-- UP
-- Project folders: every file of an app's project lives in XENO Storage (owner, 2026-10-23: "everything the project
-- and etc needs to be storage level", "files in the project", "all account bound"). Decision record:
-- `XENO WORKSHOP FILES IN STORAGE - DECISION.md` in the workspace root.
--
-- One project ↔ one Storage folder. The folder is an ordinary personal or team folder: it is owned by the account
-- that made the project (or its workspace), counts toward that account's allowance, and is opened by Storage's own
-- check — nothing here grants access. The app's working copy (a sandbox volume) is a cache of this folder.
--
-- `project_files` maps a path inside the project to a Storage FILE id (the id every version shares), so a path is one
-- file with a history, and two writers creating the same path at once meet on the primary key instead of making two.
-- The file also sits in a Storage sub-folder mirroring its directory, so a person browsing Storage sees the project
-- as it is laid out. Additive: no existing table changes.
CREATE TABLE IF NOT EXISTS project_folders (
  app text NOT NULL CHECK (app ~ '^[a-z][a-z0-9-]{1,63}$'),
  project_id uuid NOT NULL,
  folder_id uuid NOT NULL UNIQUE REFERENCES storage_folders(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app, project_id)
);
CREATE TABLE IF NOT EXISTS project_files (
  app text NOT NULL,
  project_id uuid NOT NULL,
  path text NOT NULL CHECK (length(path) BETWEEN 1 AND 1024),
  file_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app, project_id, path),
  FOREIGN KEY (app, project_id) REFERENCES project_folders(app, project_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS project_files_file ON project_files (file_id);

-- DOWN
DROP TABLE IF EXISTS project_files;
DROP TABLE IF EXISTS project_folders;
