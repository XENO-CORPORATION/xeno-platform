-- UP
-- XENO Storage: a file keeps ONE id through every version (owner, 2026-10-16: stable file ids across versions).
--
-- A version is a new user_files row (services/storageVersions.js), so until now "the file" had a different id after
-- every upload, and anything that remembered it — a desktop sync client, a canvas card, a task link — pointed at a
-- superseded row. This is the Drive / Dropbox model: a FILE id that never changes, and a REVISION id per version.
-- `file_id` is the file id; the row's own `id` stays the revision id. They are different values, so an id is never
-- ambiguous: a revision id always means that exact version (what a chat message attached), a file id always means
-- the file, now its newest version. Every row id handed out before this keeps meaning exactly what it meant.
--
-- `file_id` is DERIVED, never chosen by a caller: a trigger takes it from the row a version replaces, or mints a new
-- one for a first version, and an update can never move a row to another file. Two writers cannot make it disagree
-- with the version chain.
ALTER TABLE user_files ADD COLUMN IF NOT EXISTS file_id uuid;

-- backfill first (before the trigger exists): each chain gets one new id, shared by all its rows
WITH RECURSIVE roots AS (
  SELECT id, gen_random_uuid() AS fid FROM user_files WHERE replaces_asset_id IS NULL AND file_id IS NULL
), chain AS (
  SELECT id, fid FROM roots
  UNION ALL SELECT f.id, chain.fid FROM user_files f JOIN chain ON f.replaces_asset_id = chain.id
)
UPDATE user_files u SET file_id = chain.fid FROM chain WHERE u.id = chain.id AND u.file_id IS NULL;
UPDATE user_files SET file_id = gen_random_uuid() WHERE file_id IS NULL;   -- a row whose chain is broken stands alone

CREATE OR REPLACE FUNCTION user_files_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.replaces_asset_id IS NOT NULL THEN
    SELECT p.file_id INTO NEW.file_id FROM user_files p WHERE p.id = NEW.replaces_asset_id;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.file_id := OLD.file_id;
  ELSE
    NEW.file_id := NULL;
  END IF;
  IF NEW.file_id IS NULL THEN NEW.file_id := gen_random_uuid(); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS user_files_lineage ON user_files;
CREATE TRIGGER user_files_lineage BEFORE INSERT OR UPDATE OF replaces_asset_id, file_id ON user_files
  FOR EACH ROW EXECUTE FUNCTION user_files_lineage();

ALTER TABLE user_files ALTER COLUMN file_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_files_file_id ON user_files(file_id);

-- DOWN
DROP INDEX IF EXISTS idx_user_files_file_id;
DROP TRIGGER IF EXISTS user_files_lineage ON user_files;
DROP FUNCTION IF EXISTS user_files_lineage();
ALTER TABLE user_files DROP COLUMN IF EXISTS file_id;
