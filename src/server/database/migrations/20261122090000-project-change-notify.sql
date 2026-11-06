-- UP
-- A project's canvas is live: when a task, chat or file in the project changes, whoever has the canvas open should see
-- it. The database says so, because every way of changing them (a screen, an agent, MCP, a worker) ends up here. A NOTIFY
-- is delivered only if its transaction commits, and identical ones in a transaction arrive once.
CREATE OR REPLACE FUNCTION project_changed_notify() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_now record := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; pid uuid;
BEGIN
  IF TG_TABLE_NAME = 'storage_item_folders' THEN
    SELECT pf.project_id INTO pid FROM project_folders pf WHERE pf.app = 'projects' AND pf.folder_id = row_now.folder_id;
  ELSE
    pid := row_now.project_id;
  END IF;
  IF pid IS NOT NULL THEN PERFORM pg_notify('project_changed', pid::text); END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS tasks_project_changed ON tasks;
CREATE TRIGGER tasks_project_changed AFTER INSERT OR UPDATE OR DELETE ON tasks FOR EACH ROW EXECUTE FUNCTION project_changed_notify();
DROP TRIGGER IF EXISTS chats_project_changed ON chat_conversations;
CREATE TRIGGER chats_project_changed AFTER INSERT OR UPDATE OR DELETE ON chat_conversations FOR EACH ROW EXECUTE FUNCTION project_changed_notify();
DROP TRIGGER IF EXISTS assets_project_changed ON chat_project_assets;
CREATE TRIGGER assets_project_changed AFTER INSERT OR UPDATE OR DELETE ON chat_project_assets FOR EACH ROW EXECUTE FUNCTION project_changed_notify();
DROP TRIGGER IF EXISTS files_project_changed ON storage_item_folders;
CREATE TRIGGER files_project_changed AFTER INSERT OR UPDATE OR DELETE ON storage_item_folders FOR EACH ROW EXECUTE FUNCTION project_changed_notify();

-- DOWN
DROP TRIGGER IF EXISTS tasks_project_changed ON tasks;
DROP TRIGGER IF EXISTS chats_project_changed ON chat_conversations;
DROP TRIGGER IF EXISTS assets_project_changed ON chat_project_assets;
DROP TRIGGER IF EXISTS files_project_changed ON storage_item_folders;
DROP FUNCTION IF EXISTS project_changed_notify();
