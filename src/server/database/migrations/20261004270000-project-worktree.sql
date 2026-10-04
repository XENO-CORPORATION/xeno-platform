-- UP
-- RUN-06: projects support goal -> milestone -> task records extending the
-- existing project subsystem (ASN-08: extend projects, never a second
-- project product). Milestones declare their required evidence kinds and
-- whether a reviewer must accept; tasks complete on evidence plus reviewer
-- acceptance where required -- never on a declaration alone.
CREATE TABLE IF NOT EXISTS project_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  success_evidence TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed')),
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS project_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES project_goals(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  required_evidence_kinds TEXT[] NOT NULL DEFAULT '{}',
  reviewer_required BOOLEAN NOT NULL DEFAULT FALSE,
  reviewer_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed')),
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (reviewer_required = FALSE OR reviewer_user_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS project_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id UUID NOT NULL REFERENCES project_milestones(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  assignee_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in-review', 'completed')),
  completed_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  accepted_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS project_task_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  attached_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  attached_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_goals_project ON project_goals(project_id);
CREATE INDEX IF NOT EXISTS idx_project_milestones_goal ON project_milestones(goal_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_milestone ON project_tasks(milestone_id);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM project_task_evidence) THEN
    RAISE EXCEPTION 'task evidence rollback refused: evidence exists' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM project_tasks) THEN
    RAISE EXCEPTION 'project task rollback refused: tasks exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM project_milestones) THEN
    RAISE EXCEPTION 'project milestone rollback refused: milestones exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM project_goals) THEN
    RAISE EXCEPTION 'project goal rollback refused: goals exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE project_task_evidence;
  DROP TABLE project_tasks;
  DROP TABLE project_milestones;
  DROP TABLE project_goals;
END $$;
