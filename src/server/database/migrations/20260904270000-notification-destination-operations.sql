-- Notification destination mutations share the canonical workspace operation
-- journal. Secrets are never stored in receipts; a committed create can return
-- its signing secret only in the first execute response.
ALTER TABLE workspace_key_operations DROP CONSTRAINT IF EXISTS workspace_key_operations_family_check;
ALTER TABLE workspace_key_operations ADD CONSTRAINT workspace_key_operations_family_check
  CHECK (family IN ('key','membership','notification'));

ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS notification_workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS webhook_owner_active_destinations
  ON webhooks(user_id,created_at,id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS webhook_workspace_active_destinations
  ON webhooks(notification_workspace_id,user_id,created_at,id) WHERE deleted_at IS NULL AND notification_workspace_id IS NOT NULL;
