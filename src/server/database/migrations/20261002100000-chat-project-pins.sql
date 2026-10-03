-- UP
-- A pin is a per-USER preference about a project, never a project attribute: projects are shared
-- in workspaces, and one member pinning must not move another member's sidebar. Additive only.
-- Visibility is NOT stored here: reads join through the same ReBAC viewer check as the project
-- list, so a user who loses access keeps an inert row that is never returned (and can still unpin).
CREATE TABLE IF NOT EXISTS chat_project_pins (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_project_pins_user_position ON chat_project_pins(user_id, position);
CREATE INDEX IF NOT EXISTS idx_chat_project_pins_project ON chat_project_pins(project_id);

-- DOWN
DROP TABLE IF EXISTS chat_project_pins;
