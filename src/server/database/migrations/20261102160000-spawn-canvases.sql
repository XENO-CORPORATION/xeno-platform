-- UP
-- Spawn cloud canvases: the shared thing behind XENO Multiplayer's spawn.canvas/<canvasId> (services/spawnCanvases.js).
-- `id` is Spawn's own project UUID; the machine it runs on may change. Roles live in relationship_tuples
-- (spawn_canvas:<id>#parent@workspace:<w>, plus per-canvas editor/viewer invites), never here.
CREATE TABLE IF NOT EXISTS spawn_canvases (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  machine_id   text REFERENCES compute_machines(id) ON DELETE SET NULL,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_by   uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE INDEX IF NOT EXISTS spawn_canvases_machine ON spawn_canvases (machine_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS spawn_canvases_workspace ON spawn_canvases (workspace_id) WHERE deleted_at IS NULL;

-- DOWN
DELETE FROM relationship_tuples WHERE object_type = 'spawn_canvas';
DROP TABLE IF EXISTS spawn_canvases;
