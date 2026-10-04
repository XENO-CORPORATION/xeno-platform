-- UP
-- PUB-03: external developers submit participation offers, never
-- unilateral privileged assignments. A maintainer accepts a scoped task
-- engagement naming the approved actors, resources, payer, limits and
-- expiry. A pre-authorization policy may auto-accept low-risk offers but
-- can never authorize execution or open spending: auto-accepted
-- engagements carry execute_allowed = FALSE by schema law.
CREATE TABLE IF NOT EXISTS participation_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  offered_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  resource_id UUID NOT NULL REFERENCES workforce_resources(id) ON DELETE RESTRICT,
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('agent', 'team')),
  payer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  spend_limit_micro BIGINT NOT NULL CHECK (spend_limit_micro >= 0),
  execute_requested BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'declined', 'withdrawn', 'expired')),
  decided_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK ((status = 'proposed') = (decided_at IS NULL))
);
CREATE TABLE IF NOT EXISTS task_engagements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id UUID NOT NULL UNIQUE REFERENCES participation_offers(id) ON DELETE RESTRICT,
  project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  resource_id UUID NOT NULL REFERENCES workforce_resources(id) ON DELETE RESTRICT,
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('agent', 'team')),
  payer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  spend_limit_micro BIGINT NOT NULL CHECK (spend_limit_micro >= 0),
  execute_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'completed', 'revoked', 'expired')),
  origin TEXT NOT NULL CHECK (origin IN ('manual', 'auto')),
  accepted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > accepted_at),
  CHECK (origin = 'manual' OR execute_allowed = FALSE)
);
CREATE TABLE IF NOT EXISTS project_offer_policies (
  project_id UUID PRIMARY KEY REFERENCES chat_projects(id) ON DELETE CASCADE,
  auto_accept BOOLEAN NOT NULL DEFAULT FALSE,
  max_spend_micro BIGINT NOT NULL DEFAULT 0 CHECK (max_spend_micro >= 0),
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_participation_offers_project ON participation_offers(project_id, status);
CREATE INDEX IF NOT EXISTS idx_task_engagements_project ON task_engagements(project_id, state);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM task_engagements) THEN
    RAISE EXCEPTION 'engagement rollback refused: engagements exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM participation_offers) THEN
    RAISE EXCEPTION 'offer rollback refused: offers exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM project_offer_policies WHERE auto_accept OR max_spend_micro <> 0) THEN
    RAISE EXCEPTION 'offer policy rollback refused: non-default policies exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE task_engagements;
  DROP TABLE participation_offers;
  DROP TABLE project_offer_policies;
END $$;
