-- UP
-- XENO Analytics (Corpo › Analytics): dashboards over data the platform already holds (services/analytics.js).
-- ADDITIVE ONLY: one new table. DOWN drops exactly it.
-- A dashboard belongs to a WORKSPACE (XENO-WORKFORCE-01 §8.11: the workspace owns it; viewers read, editors
-- change it). `widgets` is an ordered list of { metric, days } naming metrics from the fixed catalogue in
-- analytics.js; the server refuses any metric it does not know, so a widget can never become a query.
-- Delete is soft (deleted_at) so it can be undone.
CREATE TABLE IF NOT EXISTS analytics_dashboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  widgets jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(widgets) = 'array' AND jsonb_array_length(widgets) <= 24),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS analytics_dashboards_ws ON analytics_dashboards (workspace_id, updated_at DESC) WHERE deleted_at IS NULL;
-- DOWN
DROP INDEX IF EXISTS analytics_dashboards_ws;
DROP TABLE IF EXISTS analytics_dashboards;
