-- XENO Artifacts — governance + threads + audiences (additive).
--
-- artifacts.workspace_id   : audience `workspace` — active members of that billing
--                            workspace may read while signed in (no link needed).
-- artifacts.shared_revision: the revision viewers see (NULL = always the latest);
--                            the owner always sees the latest.
-- artifacts.expires_at     : retention — set by the sweeper policy, NULL = keep.
-- artifact_comments.parent_id  : a thread. NULL = top-level.
-- artifact_comments.author_kind: 'user' (a person) or 'agent' (the publishing
--                                session replying, attributed to the owner).
-- artifact_comments.to_agent   : only comments SENT to the agent are delivered;
--                                a note between reviewers stays on the page.

ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS shared_revision INTEGER;
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_visibility_check;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_visibility_check CHECK (visibility IN ('private', 'link', 'workspace'));
CREATE INDEX IF NOT EXISTS artifacts_workspace_idx ON artifacts (workspace_id) WHERE workspace_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS artifacts_expires_idx ON artifacts (expires_at) WHERE expires_at IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE artifact_comments ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES artifact_comments(id) ON DELETE CASCADE;
ALTER TABLE artifact_comments ADD COLUMN IF NOT EXISTS author_kind TEXT NOT NULL DEFAULT 'user' CHECK (author_kind IN ('user', 'agent'));
ALTER TABLE artifact_comments ADD COLUMN IF NOT EXISTS to_agent BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS artifact_comments_thread_idx ON artifact_comments (artifact_id, parent_id, created_at);
