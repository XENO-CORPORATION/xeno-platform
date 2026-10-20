-- UP
-- XENO Publish = XENO Post (post.xenosystem.ai), reached server-to-server from the workspace (services/xenoPost.js).
-- ADDITIVE ONLY: two new tables. DOWN drops exactly these.
-- publish_workspace_links: which xeno-post workspace a XENO workspace publishes through. NOT a credential: the
-- platform authenticates each call with a 60-second assertion it signs (sub = the person, the same XENO account
-- id xeno-post already stores as users.xenoAccountId), so nothing secret is kept here. A workspace owns it and
-- only its admins change it (XENO-WORKFORCE-01 §8.11).
CREATE TABLE IF NOT EXISTS publish_workspace_links (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  post_workspace_id text NOT NULL CHECK (length(post_workspace_id) BETWEEN 1 AND 200),
  linked_by_user_id uuid NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now()
);
-- publish_confirmations: a time an AGENT proposed for a post. Publishing reaches an audience and cannot be taken
-- back, so an agent's schedule is a request; a person confirms it (and only then is the time sent to xeno-post).
CREATE TABLE IF NOT EXISTS publish_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  post_id text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  requested_by_user_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'confirmed', 'declined')),
  decided_by_user_id uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS publish_confirmations_one_pending ON publish_confirmations (workspace_id, post_id) WHERE state = 'pending';
-- DOWN
DROP INDEX IF EXISTS publish_confirmations_one_pending;
DROP TABLE IF EXISTS publish_confirmations;
DROP TABLE IF EXISTS publish_workspace_links;
