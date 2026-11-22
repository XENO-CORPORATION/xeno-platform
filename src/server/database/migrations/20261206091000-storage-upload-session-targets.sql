-- UP
-- XENO Storage upload sessions (services/storageUploads.js): where a session's file lands, decided when it opens.
--   folder_id        the folder it goes into (NULL = the top of My files, or of the session's workspace); placed by the
--                    server when the file is registered, so the name check at open and the placement agree.
--   replace_file_id  set when a file with the same name was already there and the person chose to replace it: the upload
--                    becomes that file's newest version (storageVersions.addVersion), the Box behaviour, so nothing is
--                    lost and a same-name upload is never a silent duplicate (measured 2026-11-22: two `a.txt` in one
--                    folder after two uploads).
-- Additive: new nullable columns on a table this series created.
ALTER TABLE storage_upload_sessions ADD COLUMN IF NOT EXISTS folder_id uuid;
ALTER TABLE storage_upload_sessions ADD COLUMN IF NOT EXISTS replace_file_id uuid;
-- DOWN
ALTER TABLE storage_upload_sessions DROP COLUMN IF EXISTS replace_file_id;
ALTER TABLE storage_upload_sessions DROP COLUMN IF EXISTS folder_id;
