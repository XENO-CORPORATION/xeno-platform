-- UP
-- XENO Storage upload sessions for sync clients (the XENO Storage drive, services/storageUploads.js): a session that
-- replaces ONE file, on top of the revision the client last saw, like POST /api/library/assets/file/:id/versions with
-- If-Match. The drive saves files of any size this way (the single-request route stops at 100 MB).
--   expected_revision  the revision the client's change was made on; checked when the session opens and again when
--                      it completes, so a file changed elsewhere in between ends `failed` with error_code
--                      `version_conflict` (the drive's existing conflict handling), never a silent overwrite.
--   error_code         the machine-readable reason of a failed session, beside the human `error`.
-- Additive: new nullable columns on a table this series created.
ALTER TABLE storage_upload_sessions ADD COLUMN IF NOT EXISTS expected_revision text;
ALTER TABLE storage_upload_sessions ADD COLUMN IF NOT EXISTS error_code text;
-- DOWN
ALTER TABLE storage_upload_sessions DROP COLUMN IF EXISTS error_code;
ALTER TABLE storage_upload_sessions DROP COLUMN IF EXISTS expected_revision;
