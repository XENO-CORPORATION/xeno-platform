CREATE TABLE agent_notification_scopes (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_key text NOT NULL, scope jsonb NOT NULL, rules jsonb NOT NULL DEFAULT '[]',
  revision uuid NOT NULL DEFAULT gen_random_uuid(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(workspace_id,owner_user_id,scope_key)
);
CREATE TABLE agent_notification_events (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id text NOT NULL, envelope jsonb NOT NULL, admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(workspace_id,owner_user_id,event_id)
);
ALTER TABLE webhook_deliveries ADD COLUMN notification_workspace_id uuid;
CREATE INDEX agent_notification_admission_quota ON agent_notification_events(workspace_id,owner_user_id,admitted_at);
ALTER TABLE webhook_deliveries ADD COLUMN notification_owner_id uuid;
ALTER TABLE webhook_deliveries ADD COLUMN notification_scope_key text;
ALTER TABLE webhook_deliveries ADD COLUMN notification_rule_id text;
CREATE INDEX agent_notification_delivery_scope ON webhook_deliveries(notification_workspace_id,notification_owner_id,notification_scope_key);
