-- UP
-- Workspaces / teams (multi-tenant). Membership + roles are stored as ReBAC
-- relationship_tuples (workspace:<id>#<role>@user:<id>) via authzReBAC.js; this
-- migration adds the workspace ENTITY tables + a reverse tuple index so we can
-- enumerate the workspaces a user belongs to.

-- The ReBAC tuple store lives in migrate-account-v2.js, which is NOT run by this
-- versioned migration runner. Re-create it idempotently so workspaces work even
-- when the account-v2 CLI migration hasn't been applied in this environment.
CREATE TABLE IF NOT EXISTS relationship_tuples (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type   VARCHAR(64)  NOT NULL,
  object_id     VARCHAR(128) NOT NULL,
  relation      VARCHAR(64)  NOT NULL,
  subject_type  VARCHAR(64)  NOT NULL,
  subject_id    VARCHAR(128) NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (object_type, object_id, relation, subject_type, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_reltuples_lookup
  ON relationship_tuples (object_type, object_id, subject_type, subject_id);
-- Reverse index: list every object a subject is related to (e.g. all workspaces
-- for a user). The account-v2 schema only indexes object->subject.
CREATE INDEX IF NOT EXISTS idx_reltuples_subject
  ON relationship_tuples (subject_type, subject_id, object_type);

-- Workspace entity (identity/metadata only; membership is in relationship_tuples).
CREATE TABLE IF NOT EXISTS workspaces (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  UUID NOT NULL,
  workspace_type VARCHAR(16) NOT NULL DEFAULT 'team'
                 CHECK (workspace_type IN ('personal','team')),
  name           VARCHAR(200) NOT NULL,
  slug           VARCHAR(140) NOT NULL,
  status         VARCHAR(16)  NOT NULL DEFAULT 'active',
  metadata       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (slug)
);
CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces (owner_user_id);
-- At most one personal workspace per user.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspaces_personal
  ON workspaces (owner_user_id) WHERE workspace_type = 'personal';

-- Pending/resolved invitations. Accepting an invite writes a membership tuple.
CREATE TABLE IF NOT EXISTS workspace_invites (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invited_by_user_id UUID NOT NULL,
  invited_user_id    UUID,
  invited_email      VARCHAR(320) NOT NULL,
  role               VARCHAR(32)  NOT NULL DEFAULT 'editor',
  status             VARCHAR(16)  NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','accepted','revoked','declined','expired')),
  token              VARCHAR(80)  NOT NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ,
  accepted_at        TIMESTAMPTZ,
  UNIQUE (token)
);
CREATE INDEX IF NOT EXISTS idx_ws_invites_ws ON workspace_invites (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_ws_invites_email ON workspace_invites (lower(invited_email), status);
-- Only one pending invite per (workspace, email).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ws_invites_pending
  ON workspace_invites (workspace_id, lower(invited_email)) WHERE status = 'pending';

-- Append-only administration audit.
CREATE TABLE IF NOT EXISTS workspace_audit (
  id            BIGSERIAL PRIMARY KEY,
  workspace_id  UUID NOT NULL,
  actor_user_id UUID,
  action        VARCHAR(64) NOT NULL,
  target        VARCHAR(200),
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ws_audit_ws ON workspace_audit (workspace_id, created_at DESC);

-- DOWN
DROP TABLE IF EXISTS workspace_audit;
DROP TABLE IF EXISTS workspace_invites;
DROP TABLE IF EXISTS workspaces;
DROP INDEX IF EXISTS idx_reltuples_subject;
-- relationship_tuples + idx_reltuples_lookup are shared with account-v2; leave them.
