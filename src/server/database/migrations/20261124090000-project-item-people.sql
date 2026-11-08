-- UP
-- Who is on a document, a chat or a picture in a project (docs/decisions/2026-11-08-who-is-on-a-project-item.md, owner
-- 2026-11-08: "we shoudl build hte proep think starting now"). A task already has a real assignee; these items only had
-- a person drawn on one canvas. This is the person responsible for the item IN THE PROJECT: one service writes it
-- (services/projectItemPeople.js), every canvas and screen reads it live, and an ended row is kept so who was on it stays
-- readable. Measured before writing it (production, 2026-11-08): no canvas node carried a person, so nothing to copy.
CREATE TABLE IF NOT EXISTS project_item_people (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES chat_projects(id) ON DELETE CASCADE,
  item_kind     TEXT NOT NULL CHECK (item_kind IN ('file', 'chat', 'generation')),
  item_id       UUID NOT NULL,
  principal_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'responsible' CHECK (role IN ('responsible')),
  assigned_by   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ,
  ended_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  CHECK (ended_at IS NULL OR ended_at >= assigned_at)
);
-- one live row per person per item; ended rows are history
CREATE UNIQUE INDEX IF NOT EXISTS project_item_people_live ON project_item_people (project_id, item_kind, item_id, principal_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS project_item_people_item ON project_item_people (item_kind, item_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS project_item_people_principal ON project_item_people (principal_id) WHERE ended_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS project_item_people;
