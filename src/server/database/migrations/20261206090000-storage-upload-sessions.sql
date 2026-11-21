-- UP
-- XENO Storage upload sessions (services/storageUploads.js): a file is sent in parts straight to object storage, then
-- registered once, like Google Drive's resumable uploads and Dropbox/Box upload sessions. Measured 2026-11-21: a single
-- POST to /api/upload is refused by Cloudflare above 100 MB (413 before the request reaches the platform) and gives the
-- page no progress; a session has no size wall, reports progress per part and resumes after a dropped connection.
-- A row is the session's control state; the parts live in the object store until the session completes or is aborted.
-- Additive: it changes no existing table.
CREATE TABLE IF NOT EXISTS storage_upload_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  part_size integer NOT NULL CHECK (part_size > 0),
  part_count integer NOT NULL CHECK (part_count > 0),
  object_key text NOT NULL,
  multipart_id text NOT NULL,
  backend text NOT NULL,
  area text,
  state text NOT NULL DEFAULT 'uploading' CHECK (state IN ('uploading', 'processing', 'done', 'failed', 'aborted')),
  error text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS storage_upload_sessions_user ON storage_upload_sessions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS storage_upload_sessions_open ON storage_upload_sessions (state, updated_at) WHERE state IN ('uploading', 'processing');
-- DOWN
-- Retained deliberately: an open session's row is how its parts in the object store are found and cleaned up.
