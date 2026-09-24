-- UP
-- XENO-WORKFORCE-01 ASN-09 -- project participation, with a DISCRIMINATED target.
--
--   "A project participation target is a discriminated personal-project OR workspace-project scope.
--    Workspace-project participation must reference an accepted workspace assignment;
--    personal-project participation binds directly to its canonical personal owner/project and
--    consent. Do not fabricate workspace membership to make personal/public projects fit a
--    workspace-only record. External offers create narrow engagements under either target, not
--    corporate memberships."
--
--   §12 "Workspace-project assignment variant | workspace assignment ID, project ID,
--        responsibility/role, narrowed policy; project ownership must match target workspace"
--   §12 "Personal-project participation variant | canonical personal owner/project ID,
--        resource/offer ID, accepted engagement, role/policy and revision; mutually exclusive with
--        workspace-assignment variant, never synthetic workspace lineage"
--
-- The workspace-assignment suite proved only the SCHEMA AFFORDANCE (a composite FK a participation
-- record could bind to) with a fixture table, and said so. This is the record.
--
-- ── ONE TABLE, TWO SHAPES, AND THE DATABASE CHOOSES BETWEEN THEM ───────────────────────────────
-- `target_kind` is the discriminator and each value has its own REQUIRED columns and its own
-- FORBIDDEN ones, enforced by CHECK rather than by convention -- so a workspace participation with
-- no assignment, or a personal one carrying a workspace id, is unrepresentable. One table rather
-- than two because §12 calls them variants of one thing: every reader asking "who works on this
-- project" should get both from one place, and "mutually exclusive" is a property of a row.
--
--   workspace   (resource, workspace, assignment) is a composite FK onto the ASSIGNMENT -- the device
--               the fixture proved -- so the assignment must be of THIS resource into THIS workspace.
--               The project must be owned by that same workspace ("project ownership must match
--               target workspace"), checked by the guard. And the assignment must be ACCEPTED: a
--               proposal, a revocation or an expiry admits nobody.
--   personal    no workspace, no assignment -- the refusal to invent workspace lineage is two NOT
--               NULL-forbidden columns. The project must be PERSONAL and owned by `personal_owner`,
--               and the participation carries that owner's CONSENT: who consented and when. A
--               personal project does not become a workspace to host a guest.
--
-- ── AN ENGAGEMENT, NOT A MEMBERSHIP ──────────────────────────────────────────────────────────
-- Nothing here writes a relationship tuple, a workspace membership or a team membership. An
-- external contributor's agent participating in someone's personal project is a narrow engagement
-- scoped to one project; the migration grants no ReBAC edge, which the suite asserts by counting.
--
-- ── POLICY IS NARROWED, NEVER WIDENED ────────────────────────────────────────────────────────
-- A participation's `policy` uses the same grammar as assignments. For the workspace variant it
-- may only NARROW the assignment's effective capabilities -- a project responsibility is a subset of
-- what the workspace admitted, never a way past it -- and that is checked against the effective
-- policy view, so an inherited assignment is narrowed against what it actually grants.

CREATE TABLE workforce_project_participations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id UUID NOT NULL,
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('agent','team')),
  project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE RESTRICT,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('workspace','personal')),

  -- workspace variant
  workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT,
  assignment_id UUID,

  -- personal variant: the project's canonical personal owner, and that owner's consent.
  personal_owner_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  consented_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  consented_at TIMESTAMPTZ,

  responsibility VARCHAR(200) NOT NULL CHECK (length(btrim(responsibility)) > 0),
  policy JSONB NOT NULL CHECK (workforce_assignment_policy_valid(policy)),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','ended')),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ended_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  FOREIGN KEY (resource_id, resource_kind) REFERENCES workforce_resources(id, kind) ON DELETE RESTRICT,
  -- The assignment must be of THIS resource into THIS workspace -- a composite key, not a check.
  FOREIGN KEY (resource_id, workspace_id, assignment_id)
    REFERENCES workforce_workspace_assignments(resource_id, workspace_id, id) ON DELETE RESTRICT,

  -- The discriminator, and the whole of "do not fabricate workspace membership": each variant has
  -- exactly its own columns and none of the other's.
  CONSTRAINT workforce_participation_variant CHECK (
    (target_kind = 'workspace' AND workspace_id IS NOT NULL AND assignment_id IS NOT NULL
       AND personal_owner_user_id IS NULL AND consented_at IS NULL AND consented_by_user_id IS NULL)
    OR (target_kind = 'personal' AND workspace_id IS NULL AND assignment_id IS NULL
       AND personal_owner_user_id IS NOT NULL AND consented_at IS NOT NULL)),
  CONSTRAINT workforce_participation_end CHECK ((state = 'active') = (ended_at IS NULL))
);
CREATE UNIQUE INDEX workforce_project_participations_live
  ON workforce_project_participations(resource_id, project_id) WHERE state = 'active';
CREATE INDEX workforce_project_participations_project ON workforce_project_participations(project_id, state);
CREATE INDEX workforce_project_participations_assignment
  ON workforce_project_participations(assignment_id) WHERE assignment_id IS NOT NULL;

CREATE FUNCTION workforce_project_participation_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE proj chat_projects%ROWTYPE; assignment workforce_workspace_assignments%ROWTYPE;
        granted JSONB; requested JSONB;
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'participation history is retained; end it instead' USING ERRCODE='23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF to_jsonb(NEW) = to_jsonb(OLD) THEN RETURN NEW; END IF;
    IF (to_jsonb(NEW) - ARRAY['created_by_user_id','ended_by_user_id','consented_by_user_id'])
         = (to_jsonb(OLD) - ARRAY['created_by_user_id','ended_by_user_id','consented_by_user_id'])
       AND (NEW.created_by_user_id IS NOT DISTINCT FROM OLD.created_by_user_id
            OR (NEW.created_by_user_id IS NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.created_by_user_id)))
       AND (NEW.ended_by_user_id IS NOT DISTINCT FROM OLD.ended_by_user_id
            OR (NEW.ended_by_user_id IS NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.ended_by_user_id)))
       AND (NEW.consented_by_user_id IS NOT DISTINCT FROM OLD.consented_by_user_id
            OR (NEW.consented_by_user_id IS NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.consented_by_user_id))) THEN
      RETURN NEW;
    END IF;
    -- A participation's target, its project, its terms and its consent are its identity. Only ending
    -- it is an update; anything else is a different participation.
    IF (to_jsonb(NEW) - ARRAY['state','revision','ended_at','ended_by_user_id','updated_at'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','revision','ended_at','ended_by_user_id','updated_at']) THEN
      RAISE EXCEPTION 'participation target, project, terms and consent are immutable; end it and start another' USING ERRCODE='23514';
    END IF;
    IF OLD.state = 'ended' OR NEW.state <> 'ended' OR NEW.revision <> OLD.revision + 1 THEN
      RAISE EXCEPTION 'a participation only ends, once' USING ERRCODE='23514';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- INSERT
  IF NEW.state <> 'active' OR NEW.revision <> 1 THEN
    RAISE EXCEPTION 'a participation starts active at revision 1' USING ERRCODE='23514';
  END IF;
  SELECT * INTO proj FROM chat_projects WHERE id = NEW.project_id FOR SHARE;
  IF NOT FOUND OR proj.is_archived THEN
    RAISE EXCEPTION 'an archived project admits no new participation' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM workforce_resources WHERE id = NEW.resource_id AND status = 'active') THEN
    RAISE EXCEPTION 'an archived resource starts no new participation' USING ERRCODE='23514';
  END IF;

  IF NEW.target_kind = 'workspace' THEN
    -- "project ownership must match target workspace"
    IF proj.workspace_id IS DISTINCT FROM NEW.workspace_id THEN
      RAISE EXCEPTION 'a workspace participation targets a project owned by that workspace' USING ERRCODE='23514';
    END IF;
    SELECT * INTO assignment FROM workforce_workspace_assignments WHERE id = NEW.assignment_id FOR SHARE;
    IF assignment.state <> 'accepted' OR assignment.valid_from > now()
       OR (assignment.valid_until IS NOT NULL AND assignment.valid_until <= now()) THEN
      RAISE EXCEPTION 'workspace participation requires an accepted, current workspace assignment' USING ERRCODE='23514';
    END IF;
    -- Narrowed, never widened: every requested capability must be one the assignment grants now.
    SELECT effective_capabilities INTO granted FROM workforce_assignment_effective_policy WHERE assignment_id = NEW.assignment_id;
    requested := NEW.policy -> 'capabilities';
    IF NEW.policy ->> 'mode' = 'inherit_parent' THEN
      RAISE EXCEPTION 'a participation names its capabilities; it narrows an assignment rather than inheriting one' USING ERRCODE='23514';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(requested) AS cap
                WHERE NOT (coalesce(granted, '[]'::jsonb) ? cap)) THEN
      RAISE EXCEPTION 'a participation may only narrow what its workspace assignment grants' USING ERRCODE='23514';
    END IF;
  ELSE
    -- The personal variant binds to the project's CANONICAL personal owner, never a stand-in.
    IF proj.workspace_id IS NOT NULL OR proj.owner_user_id IS DISTINCT FROM NEW.personal_owner_user_id THEN
      RAISE EXCEPTION 'a personal participation targets a personal project, and names its owner' USING ERRCODE='23514';
    END IF;
    IF NEW.consented_by_user_id IS DISTINCT FROM NEW.personal_owner_user_id THEN
      RAISE EXCEPTION 'a personal participation carries its project owner''s consent' USING ERRCODE='23514';
    END IF;
    IF NEW.policy ->> 'mode' = 'inherit_parent' THEN
      RAISE EXCEPTION 'a personal participation has no parent grant to inherit' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER workforce_project_participations_guard
BEFORE INSERT OR UPDATE OR DELETE ON workforce_project_participations
FOR EACH ROW EXECUTE FUNCTION workforce_project_participation_guard();
CREATE TRIGGER workforce_project_participations_no_truncate
BEFORE TRUNCATE ON workforce_project_participations
FOR EACH STATEMENT EXECUTE FUNCTION workforce_project_participation_guard();

-- What a participation grants NOW, in one place, like assignments. A workspace participation is live
-- only while its assignment is live, and its capabilities are always the intersection with what that
-- assignment effectively grants -- so an assignment later revoked, or narrowed by a dead parent,
-- narrows every participation built on it without anyone rewriting a row.
CREATE VIEW workforce_participation_effective_policy AS
SELECT pp.id AS participation_id, pp.resource_id, pp.project_id, pp.target_kind,
  CASE
    WHEN pp.state <> 'active' THEN '[]'::jsonb
    WHEN pp.target_kind = 'personal' THEN pp.policy -> 'capabilities'
    ELSE coalesce((SELECT jsonb_agg(cap ORDER BY cap)
                     FROM jsonb_array_elements_text(pp.policy -> 'capabilities') AS cap
                    WHERE ep.effective_capabilities ? cap), '[]'::jsonb)
  END AS effective_capabilities
FROM workforce_project_participations pp
LEFT JOIN workforce_assignment_effective_policy ep ON ep.assignment_id = pp.assignment_id;

DO $harden$
BEGIN
  EXECUTE format('ALTER FUNCTION %I.workforce_project_participation_guard() SET search_path = %I, pg_temp',
    current_schema(), current_schema());
END $harden$;

-- DOWN
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM workforce_project_participations) THEN
    RAISE EXCEPTION 'participation rollback refused: retained records exist' USING ERRCODE='23514';
  END IF;
END $$;
DROP VIEW workforce_participation_effective_policy;
DROP TRIGGER workforce_project_participations_no_truncate ON workforce_project_participations;
DROP TRIGGER workforce_project_participations_guard ON workforce_project_participations;
DROP FUNCTION workforce_project_participation_guard();
DROP TABLE workforce_project_participations;
