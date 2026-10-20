-- UP
-- XENO Storage (codename Arca): a FOLDER shared by a link that REQUIRES SIGN-IN (services/storageFolderLinks.js).
-- Unlike a file link (storage_shares kind 'link', a bearer capability), opening one of these needs a live account
-- session, and every open and download is recorded against that account. Only the token's SHA-256 is stored.
-- ADDITIVE ONLY: two new tables and one new nullable column. DOWN drops exactly these.
-- ACCESS is not held by the link. A signed-in open ADMITS the account: a `person` viewer share on the folder,
-- marked with the link it came through (storage_shares.via_link_id), turned into tuples by reconcileShares like any
-- other share. Revoking the link revokes every share made through it.
CREATE TABLE IF NOT EXISTS storage_folder_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id uuid NOT NULL REFERENCES storage_folders(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  token_sha256 text NOT NULL UNIQUE,
  label text CHECK (label IS NULL OR length(label) BETWEEN 1 AND 120),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS storage_folder_links_folder ON storage_folder_links (folder_id) WHERE revoked_at IS NULL;
-- who opened a link and what they downloaded: always an account (the link cannot be used signed out)
CREATE TABLE IF NOT EXISTS storage_folder_link_events (
  id bigserial PRIMARY KEY,
  link_id uuid NOT NULL REFERENCES storage_folder_links(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  event text NOT NULL CHECK (event IN ('open', 'download')),
  file_id uuid,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS storage_folder_link_events_link ON storage_folder_link_events (link_id, at DESC);
-- the share an account got by opening a sign-in link; NULL for a share made by name
ALTER TABLE storage_shares ADD COLUMN IF NOT EXISTS via_link_id uuid REFERENCES storage_folder_links(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS storage_shares_via_link ON storage_shares (via_link_id) WHERE via_link_id IS NOT NULL;
-- DOWN
DROP INDEX IF EXISTS storage_shares_via_link;
ALTER TABLE storage_shares DROP COLUMN IF EXISTS via_link_id;
DROP TABLE IF EXISTS storage_folder_link_events;
DROP TABLE IF EXISTS storage_folder_links;
