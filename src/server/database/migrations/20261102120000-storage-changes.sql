-- UP
-- XENO Storage: a change log for the desktop drive (GET /api/library/changes). The XENO Storage drive on a PC used to
-- relist every folder it had shown every 30 seconds; with this it asks "what changed since?" and relists only those
-- folders (the model of OneDrive /delta and Google Drive's changes feed).
--
-- Written by TRIGGERS, so no write path can forget it: folders (made, renamed, moved, removed), an item's placement
-- (moved between folders or to the top), and files (added, renamed, a new size, trashed, restored, purged). A row is
-- the folder whose listing changed; folder_id NULL is the top level. Other Library sources (generations, images,
-- artifacts) are not logged: the drive's periodic full relist picks them up.
--
-- The log never stands in the way of the write it records: every trigger swallows its own failure.
-- Kept 7 days; a cursor older than that gets "rescan". Additive: no existing table changes.
CREATE TABLE IF NOT EXISTS storage_changes (
  id bigserial PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  folder_id uuid,
  at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS storage_changes_owner_at ON storage_changes (owner_user_id, at);
CREATE INDEX IF NOT EXISTS storage_changes_at ON storage_changes (at);

CREATE OR REPLACE FUNCTION storage_note_change(owner uuid, folder uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF owner IS NULL THEN RETURN; END IF;
  INSERT INTO storage_changes (owner_user_id, folder_id) VALUES (owner, folder);
EXCEPTION WHEN OTHERS THEN
  NULL; -- a change log must never fail the write it records
END $$;

CREATE OR REPLACE FUNCTION storage_changes_folders() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN PERFORM storage_note_change(NEW.owner_user_id, NEW.parent_id); END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM storage_note_change(OLD.owner_user_id, OLD.parent_id); END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS storage_changes_folders ON storage_folders;
CREATE TRIGGER storage_changes_folders AFTER INSERT OR UPDATE OR DELETE ON storage_folders
  FOR EACH ROW EXECUTE FUNCTION storage_changes_folders();

-- An item joins, leaves or changes folder. Leaving a folder for the top deletes the row, joining one from the top
-- inserts it, so the top level changes too.
CREATE OR REPLACE FUNCTION storage_changes_placement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner uuid;
BEGIN
  BEGIN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      SELECT owner_user_id INTO owner FROM storage_folders WHERE id = NEW.folder_id;
      PERFORM storage_note_change(owner, NEW.folder_id);
      PERFORM storage_note_change(owner, NULL);
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      SELECT owner_user_id INTO owner FROM storage_folders WHERE id = OLD.folder_id;
      PERFORM storage_note_change(owner, OLD.folder_id);
      PERFORM storage_note_change(owner, NULL);
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS storage_changes_placement ON storage_item_folders;
CREATE TRIGGER storage_changes_placement AFTER INSERT OR UPDATE OR DELETE ON storage_item_folders
  FOR EACH ROW EXECUTE FUNCTION storage_changes_placement();

-- A file is added, renamed, resized, trashed or restored, or purged: the folder it is in (or the top) changed.
CREATE OR REPLACE FUNCTION storage_changes_files() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; place uuid;
BEGIN
  BEGIN
    IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
    SELECT folder_id INTO place FROM storage_item_folders WHERE source = 'file' AND source_id = r.id;
    PERFORM storage_note_change(COALESCE(r.owner_user_id, r.user_id), place);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS storage_changes_files ON user_files;
CREATE TRIGGER storage_changes_files AFTER INSERT OR DELETE OR UPDATE OF filename, original_name, file_size, deleted_at, workspace_id ON user_files
  FOR EACH ROW EXECUTE FUNCTION storage_changes_files();

-- DOWN
DROP TRIGGER IF EXISTS storage_changes_files ON user_files;
DROP TRIGGER IF EXISTS storage_changes_placement ON storage_item_folders;
DROP TRIGGER IF EXISTS storage_changes_folders ON storage_folders;
DROP FUNCTION IF EXISTS storage_changes_files();
DROP FUNCTION IF EXISTS storage_changes_placement();
DROP FUNCTION IF EXISTS storage_changes_folders();
DROP FUNCTION IF EXISTS storage_note_change(uuid, uuid);
DROP TABLE IF EXISTS storage_changes;
