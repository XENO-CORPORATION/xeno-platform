-- UP
-- Canvases: an infinite board where tasks, notes, links and groups sit together (owner, 2026-10-15).
--
-- A canvas is a PLATFORM document, not a Tasks one: it can hold tasks today and docs, notes and agents later, so it
-- cannot belong to Tasks alone. Its content is JSON Canvas 1.0 (jsoncanvas.org) -- nodes and edges -- with one
-- extension: a node of type `xeno-ref` POINTS at a real record by stable id ({kind:'task', id:'T-12'}) and stores
-- only its place on the canvas. Title, status and assignee are always read live from the record, so a canvas can
-- never hold a stale copy of a task (the drift Miro/Jira and ClickUp whiteboards are known for).
--
-- Who sees it follows its owner scope: a project canvas follows the project's relations (the same check a project
-- uses); a personal canvas is its owner's alone. `revision` is the optimistic-concurrency counter a save must name.

CREATE TABLE IF NOT EXISTS canvases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id  uuid NULL REFERENCES chat_projects(id) ON DELETE CASCADE,
  area        text NULL CHECK (area IS NULL OR area ~ '^[a-z][a-z0-9_-]{0,39}$'),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  content     jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb
              CHECK (jsonb_typeof(content) = 'object' AND jsonb_typeof(content->'nodes') = 'array'
                     AND jsonb_typeof(content->'edges') = 'array' AND length(content::text) <= 1000000),
  revision    bigint NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz NULL
);
CREATE INDEX IF NOT EXISTS idx_canvases_project ON canvases(project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_canvases_owner ON canvases(owner_user_id) WHERE deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS canvases;
