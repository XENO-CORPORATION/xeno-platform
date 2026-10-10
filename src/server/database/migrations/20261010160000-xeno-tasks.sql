-- UP
-- XENO Tasks (codename Telos; product spec: xeno-tasks/SPEC.md). The shared work tracker for people and agents.
--
-- A task lives in a project (chat_projects, whose relationship rows decide who may see and move it) or, with no
-- project, belongs to its owner alone. `area` places it in the workspace (each area its own; Overview all), and a task
-- inside a project reads the project's area. One state machine for everyone (SPEC §3); every change is a row in
-- task_events, written once.
CREATE TABLE IF NOT EXISTS tasks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number           BIGSERIAL UNIQUE,                       -- the human key: T-<number>, never reused
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  body             TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 50000),
  kind             TEXT NOT NULL DEFAULT 'task' CHECK (kind IN ('task', 'bug', 'feature', 'question')),
  status           TEXT NOT NULL DEFAULT 'raised' CHECK (status IN ('raised', 'todo', 'in_progress', 'blocked', 'in_review', 'done', 'wont_do')),
  priority         TEXT NOT NULL DEFAULT 'none' CHECK (priority IN ('none', 'low', 'medium', 'high', 'urgent')),
  project_id       UUID REFERENCES chat_projects(id) ON DELETE SET NULL,
  milestone_id     UUID REFERENCES project_milestones(id) ON DELETE SET NULL,
  area             TEXT CHECK (area IS NULL OR area ~ '^[a-z][a-z0-9_-]{0,39}$'),
  owner_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,   -- whose personal task it is when there is no project
  reporter_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  reporter_kind    TEXT NOT NULL DEFAULT 'human' CHECK (reporter_kind IN ('human', 'agent', 'service')),
  assignee_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewer_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  review_required  BOOLEAN NOT NULL DEFAULT FALSE,
  labels           TEXT[] NOT NULL DEFAULT '{}',
  due_at           TIMESTAMPTZ,
  source           TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'chat', 'forum_ticket', 'forum_thread', 'agent')),
  source_ref       TEXT CHECK (source_ref IS NULL OR length(source_ref) <= 200),
  conversation_id  UUID REFERENCES chat_conversations(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at        TIMESTAMPTZ,
  CHECK (project_id IS NOT NULL OR owner_user_id IS NOT NULL),
  CHECK (review_required = FALSE OR reviewer_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, status) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_user_id, status) WHERE project_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id, status) WHERE assignee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_area ON tasks(area) WHERE area IS NOT NULL;

CREATE TABLE IF NOT EXISTS task_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_kind  TEXT NOT NULL CHECK (actor_kind IN ('human', 'agent', 'service')),
  kind        TEXT NOT NULL CHECK (kind IN ('created', 'edited', 'status', 'assigned', 'claimed', 'comment')),
  from_value  TEXT,
  to_value    TEXT,
  note        TEXT CHECK (note IS NULL OR length(note) <= 20000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id, created_at);

-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tasks) THEN
    RAISE EXCEPTION 'xeno-tasks rollback refused: tasks exist' USING ERRCODE = '23514';
  END IF;
  DROP TABLE IF EXISTS task_events;
  DROP TABLE IF EXISTS tasks;
END $$;
