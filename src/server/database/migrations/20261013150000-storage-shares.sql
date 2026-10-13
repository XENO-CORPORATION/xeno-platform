-- UP
-- XENO Storage (codename Arca): SHARING a file, and extra space.
-- storage_shares: one row per share of one file. kind 'person' gives one account read access (the access
-- itself is a `viewer` relationship tuple on the file; this row is the record of who gave it and when).
-- kind 'link' is a secret link: only the SHA-256 of its token is stored, so a database read does not leak links.
CREATE TABLE IF NOT EXISTS storage_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('person', 'link')),
  grantee_user_id uuid,
  token_sha256 text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'person' AND grantee_user_id IS NOT NULL AND token_sha256 IS NULL) OR (kind = 'link' AND token_sha256 IS NOT NULL AND grantee_user_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS storage_shares_token ON storage_shares (token_sha256) WHERE token_sha256 IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS storage_shares_person ON storage_shares (file_id, grantee_user_id) WHERE kind = 'person' AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS storage_shares_file ON storage_shares (file_id) WHERE revoked_at IS NULL;
-- storage_grants: space added to an account on top of its plan (a purchase, or a grant by staff).
CREATE TABLE IF NOT EXISTS storage_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  bytes bigint NOT NULL CHECK (bytes > 0),
  reason text NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS storage_grants_user ON storage_grants (user_id) WHERE revoked_at IS NULL;
-- DOWN
-- Retained deliberately: these rows are who shared what with whom, and space people were given.
