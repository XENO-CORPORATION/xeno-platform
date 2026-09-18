-- XENO Artifacts — the hosted home of agent-published rendered pages.
--
-- A page published from XENO Agent (SDK artifact kind `page`) can be PROMOTED
-- here: bytes go to object storage under a content-addressed key, the record
-- lives in these tables, and the page is served at /a/<id> by the viewer route.
-- Private by default; `visibility='link'` mints a share token. Comments are
-- delivered back to the publishing session, which polls and acknowledges them.
--
-- Additive only. Nothing here touches an existing table.

CREATE TABLE IF NOT EXISTS artifacts (
  id                 TEXT PRIMARY KEY,                       -- 'a_' + 22 url-safe chars, minted server-side
  owner_user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL DEFAULT 'page' CHECK (kind IN ('page')),
  title              TEXT NOT NULL,
  description        TEXT,
  icon               TEXT,
  current_revision   INTEGER NOT NULL DEFAULT 0,
  visibility         TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'link')),
  share_token_hash   TEXT UNIQUE,                            -- sha256 of the share token; the token itself is shown once
  source_artifact_id TEXT,                                   -- the local page_… id this was promoted from, for the CLI's records
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS artifacts_owner_idx ON artifacts (owner_user_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS artifact_revisions (
  artifact_id   TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  revision      INTEGER NOT NULL,
  content_hash  TEXT NOT NULL,                               -- sha256 over index.html + every file (path + hash), the SDK's rule
  size_bytes    INTEGER NOT NULL,
  storage_prefix TEXT NOT NULL,                              -- 'artifacts/<id>/r<rev>/' in the storage backend
  files         JSONB NOT NULL DEFAULT '{}'::jsonb,          -- { "<path>": { "sha256", "sizeBytes", "contentType" } } — index.html included
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (artifact_id, revision)
);

CREATE TABLE IF NOT EXISTS artifact_comments (
  id            TEXT PRIMARY KEY,                            -- 'c_' + 22 url-safe chars
  artifact_id   TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  revision      INTEGER NOT NULL,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body          TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  selector      TEXT,                                        -- optional DOM selector the comment points at
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at  TIMESTAMPTZ                                  -- set by the publishing session when it has taken the comment into a turn
);
CREATE INDEX IF NOT EXISTS artifact_comments_undelivered_idx ON artifact_comments (artifact_id, created_at) WHERE delivered_at IS NULL;
