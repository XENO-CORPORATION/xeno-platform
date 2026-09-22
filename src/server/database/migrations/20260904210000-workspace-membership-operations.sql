-- UP
-- Generalize the existing durable authority without losing key tombstones.
ALTER TABLE workspace_key_operations ADD COLUMN IF NOT EXISTS family TEXT NOT NULL DEFAULT 'key' CHECK (family IN ('key','membership'));
ALTER TABLE workspace_key_operations DROP CONSTRAINT workspace_key_operations_pkey;
ALTER TABLE workspace_key_operations ADD PRIMARY KEY (workspace_id,actor_user_id,client_id,operation_id,family);
CREATE TABLE workspace_invite_deliveries (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  invite_id UUID NOT NULL,
  invite_expires_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','dispatching','accepted','skipped','unknown')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX workspace_invite_deliveries_pending ON workspace_invite_deliveries(created_at) WHERE state='pending';
-- DOWN
-- Do not erase duplicate fences or uncertain delivery evidence on rollback.
