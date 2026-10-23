-- UP
-- XENO Message = XENO Comms, reached server-to-server from the workspace (services/xenoComms.js).
-- The platform keeps NO messages: Comms stores every message, member and receipt. These tables are LINKS only —
-- which Comms user and device a platform principal is, which Comms conversation a workspace scope maps to, and
-- which Comms conversation is a direct message between two platform users — plus the single-use ledger for the
-- 60-second assertions Comms sends back here to be verified. ADDITIVE ONLY; DOWN drops exactly these.

-- A platform principal (a person or an agent) as a Comms member. comms_device_id is the 'embed' device the
-- workspace registered for them, NULL for a member Comms created from a scope sync who has never sent from here.
-- Not a credential: every call is authenticated by a fresh assertion the platform signs.
CREATE TABLE IF NOT EXISTS comms_members (
  platform_user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  comms_user_id uuid NOT NULL UNIQUE,
  comms_device_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One Comms channel per workspace scope: `workspace`, `division:<id>`, `team:<id>` or `project:<id>`.
CREATE TABLE IF NOT EXISTS comms_channels (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scope_key text NOT NULL CHECK (scope_key ~ '^(workspace|(division|team|project):[0-9a-f-]{36})$'),
  comms_conversation_id uuid NOT NULL UNIQUE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  member_count integer NOT NULL DEFAULT 0,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, scope_key)
);

-- A direct message between two platform users (Comms keeps one per pair). The workspace shows it only while the
-- other person is still a member of that workspace.
CREATE TABLE IF NOT EXISTS comms_direct_messages (
  user_low uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comms_conversation_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_low, user_high),
  CHECK (user_low < user_high)
);

-- Each assertion is accepted once (Comms verifies it by calling GET /api/comms/identity).
CREATE TABLE IF NOT EXISTS comms_assertion_uses (
  jti uuid PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS comms_assertion_uses_expiry ON comms_assertion_uses (expires_at);
-- DOWN
DROP INDEX IF EXISTS comms_assertion_uses_expiry;
DROP TABLE IF EXISTS comms_assertion_uses;
DROP TABLE IF EXISTS comms_direct_messages;
DROP TABLE IF EXISTS comms_channels;
DROP TABLE IF EXISTS comms_members;
