-- UP
-- XENO Extension installations: a browser a person has connected so their platform chats can use it
-- (docs/CHAT-TOOL-CALLING-PLAN.md, "Browser tools", approved 2026-10-16).
--
-- An installation is a device the person owns. It is bound to the DPoP key it registered with (`dpop_jkt`): only a
-- token bound to that key can connect as it, so a copied access token cannot drive the browser from anywhere else.
-- `enabled` is the person's own switch ("Allow XENO chats to use this browser"), mirrored from the extension and from the
-- account page. Revoking deletes nothing of the person's; it sets `revoked_at`, which closes the connection and fails
-- any queued call.
CREATE TABLE IF NOT EXISTS browser_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installation_id uuid NOT NULL,
  dpop_jkt text NOT NULL CHECK (dpop_jkt ~ '^[A-Za-z0-9_-]{43}$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  browser text CHECK (browser IS NULL OR char_length(browser) <= 40),
  os text CHECK (os IS NULL OR char_length(os) <= 40),
  enabled boolean NOT NULL DEFAULT false,
  extension_version text CHECK (extension_version IS NULL OR char_length(extension_version) <= 40),
  tools jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tools) = 'array'),
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
-- one live row per (person, installation); a revoked installation that registers again is a new row
CREATE UNIQUE INDEX IF NOT EXISTS browser_installations_live ON browser_installations (user_id, installation_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS browser_installations_user ON browser_installations (user_id) WHERE revoked_at IS NULL;

-- A call the chat sent to an installation, kept until it has a result or passes its deadline, so a call sent while
-- the browser's socket is down is delivered on reconnect, and a duplicate result is ignored (call_id is the key).
CREATE TABLE IF NOT EXISTS browser_calls (
  call_id uuid PRIMARY KEY,
  installation uuid NOT NULL REFERENCES browser_installations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id text,
  tool text NOT NULL CHECK (tool ~ '^[a-z][a-z0-9_]{0,63}$'),
  args jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The tab-group title the extension should open this conversation's tabs under (the chat's own title,
  -- cut to 40). Carried on the row so a call delivered after a reconnect still groups correctly.
  tab_group text CHECK (tab_group IS NULL OR char_length(tab_group) <= 40),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'sent', 'acked', 'waiting_approval', 'done', 'failed')),
  ok boolean,
  result jsonb,
  error_code text,
  deadline timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS browser_calls_pending ON browser_calls (installation, created_at) WHERE state IN ('queued', 'sent');
CREATE INDEX IF NOT EXISTS browser_calls_age ON browser_calls (created_at);

-- DOWN
DROP TABLE IF EXISTS browser_calls;
DROP TABLE IF EXISTS browser_installations;
