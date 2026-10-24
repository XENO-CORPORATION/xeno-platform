-- UP
-- What happened to a project's paths through the project-folder API, for its change feed
-- (services/projectFolders.js `projectChanges`). Writes made in Storage itself (a new version, the trash) are read from
-- user_files, so this only needs what leaves no row there: a path removed or moved away. Additive.
CREATE TABLE IF NOT EXISTS project_file_events (
  id bigserial PRIMARY KEY,
  app text NOT NULL,
  project_id uuid NOT NULL,
  path text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('remove')),
  file_id uuid,
  at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS project_file_events_at ON project_file_events (app, project_id, at);

-- DOWN
DROP TABLE IF EXISTS project_file_events;
