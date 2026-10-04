-- UP
-- PUB-12: issue/task discussion with contributor attribution,
-- report/appeal, spam/abuse moderation, rate/concurrency limits and
-- maintainer blocking. Recognition follows reviewed outcomes only:
-- one attribution row per contribution, basis pinned by schema, no
-- metric columns to reward.
CREATE TABLE IF NOT EXISTS task_discussion_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 8000),
  state TEXT NOT NULL DEFAULT 'visible' CHECK (state IN ('visible', 'hidden', 'removed')),
  hidden_by_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  hidden_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_discussion_posts_task ON task_discussion_posts(task_id, created_at, id);
CREATE TABLE IF NOT EXISTS task_discussion_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES task_discussion_posts(id) ON DELETE CASCADE,
  reporter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'abuse', 'offtopic', 'other')),
  detail TEXT NULL CHECK (detail IS NULL OR length(detail) BETWEEN 1 AND 2000),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'upheld', 'dismissed')),
  decided_by_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_discussion_reports_open
  ON task_discussion_reports(post_id, reporter_user_id) WHERE state = 'open';
CREATE TABLE IF NOT EXISTS task_discussion_appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES task_discussion_posts(id) ON DELETE CASCADE,
  appellant_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  grounds TEXT NOT NULL CHECK (length(btrim(grounds)) BETWEEN 1 AND 2000),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'upheld', 'dismissed')),
  decided_by_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_discussion_appeals_open
  ON task_discussion_appeals(post_id) WHERE state = 'open';
CREATE TABLE IF NOT EXISTS project_discussion_blocks (
  project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE CASCADE,
  blocked_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, blocked_user_id)
);
-- Recognition: exactly one row per contribution, basis pinned. There
-- are no token, claim-count or self-report columns by design.
CREATE TABLE IF NOT EXISTS contribution_attributions (
  contribution_id UUID PRIMARY KEY REFERENCES contributions(id) ON DELETE CASCADE,
  attributed_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  basis TEXT NOT NULL DEFAULT 'reviewed_outcome' CHECK (basis = 'reviewed_outcome'),
  recorded_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM task_discussion_posts) THEN
    RAISE EXCEPTION 'discussion rollback refused: posts exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM contribution_attributions) THEN
    RAISE EXCEPTION 'discussion rollback refused: attributions exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE contribution_attributions;
  DROP TABLE project_discussion_blocks;
  DROP TABLE task_discussion_appeals;
  DROP TABLE task_discussion_reports;
  DROP TABLE task_discussion_posts;
END $$;
