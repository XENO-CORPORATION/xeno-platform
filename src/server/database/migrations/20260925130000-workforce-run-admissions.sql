-- UP
-- XENO-WORKFORCE-01 RUN-01 and RUN-02 -- the run ADMISSION record (§12 "Admission v2").
--
--   RUN-01: "Admission records exact actor/principal, agent version, conversation, optional team,
--            owner, target assignment/project, root binding, policy revision, entitlement and payer.
--            Resolve from authoritative state; requested UI fields are not proof."
--   RUN-02: "Contextual rights are the intersection of actor authorization, resource-use rights,
--            target assignment, runtime capability policy, entitlement restrictions and explicit
--            budget approval. No owner/assignment union via generic parent traversal."
--
-- An admission is the platform's DECISION that one run may start: who asked, which pinned agent
-- definition runs, for which explicit target, under which live grant and at what revision, who pays
-- and up to what ceiling -- and the capabilities that survive the intersection. It is written once,
-- by services/workforceRunAdmission.js, from authoritative rows it resolves and locks itself; every
-- identifier the caller sends is a request to be checked, never a fact to be recorded.
--
-- WHAT THIS TABLE HOLDS AS ITS OWN INVARIANTS, so no writer can record a wider admission than the
-- rules allow, whoever the writer is:
--   * the target is one of three explicit shapes (personal / workspace assignment / project
--     participation) and names exactly the fields that shape needs;
--   * a team run names the admitted membership and member set it runs under, and its function is
--     `manager` or `worker` -- an `observer` may not dispatch (ROLE-02), so an observer admission is
--     unrepresentable;
--   * the effective capabilities are contained in EVERY term of the intersection that was recorded --
--     the request, the pinned definition, the target grant, the runtime ceiling and, when one applies,
--     the entitlement -- so an admission cannot claim a right one of its own terms withheld;
--   * a budget is explicit: one named payer and a positive ceiling;
--   * it is immutable and retained: a changed decision is a new admission.
--
-- Actor, payer and owner ids are tombstones rather than cascading foreign keys, like the other
-- receipts here: erasing an account must not erase the record that it once admitted work.

CREATE TABLE workforce_run_admissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL,
  client_id VARCHAR(128) NOT NULL CHECK (client_id ~ '^[a-zA-Z0-9._-]{1,128}$'),
  operation_id UUID NOT NULL,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  incarnation_hash TEXT NOT NULL CHECK (incarnation_hash ~ '^[0-9a-f]{64}$'),

  -- The pinned definition (RUN-03: pins preserve reproducibility).
  agent_resource_id UUID NOT NULL,
  agent_version INTEGER NOT NULL,
  agent_content_hash TEXT NOT NULL CHECK (agent_content_hash ~ '^[0-9a-f]{64}$'),

  -- The explicit target.
  target_kind TEXT NOT NULL CHECK (target_kind IN ('personal','workspace','project')),
  target_owner_user_id UUID,
  target_workspace_id UUID,
  project_id UUID REFERENCES chat_projects(id) ON DELETE RESTRICT,
  assignment_id UUID REFERENCES workforce_workspace_assignments(id) ON DELETE RESTRICT,
  assignment_revision BIGINT CHECK (assignment_revision > 0),
  participation_id UUID REFERENCES workforce_project_participations(id) ON DELETE RESTRICT,
  participation_revision BIGINT CHECK (participation_revision > 0),

  -- The optional team, and the exact admitted membership the run acts under.
  team_id UUID,
  team_kind TEXT CHECK (team_kind = 'team'),
  team_membership_id UUID REFERENCES workforce_team_memberships(id) ON DELETE RESTRICT,
  team_membership_revision BIGINT CHECK (team_membership_revision > 0),
  member_set_revision BIGINT CHECK (member_set_revision > 0),
  team_function TEXT CHECK (team_function IN ('manager','worker')),

  conversation_id UUID,
  root_binding_id UUID,
  root_binding_revision BIGINT CHECK (root_binding_revision > 0),
  host_installation_id TEXT CHECK (host_installation_id IS NULL OR host_installation_id ~ '^[A-Za-z0-9_-]{43}$'),
  entitlement_id UUID,

  payer_kind TEXT NOT NULL CHECK (payer_kind = 'user'),
  payer_user_id UUID NOT NULL,
  budget_ceiling_micro BIGINT NOT NULL CHECK (budget_ceiling_micro > 0),

  requested_capabilities JSONB NOT NULL CHECK (jsonb_typeof(requested_capabilities) = 'array'),
  effective_capabilities JSONB NOT NULL CHECK (jsonb_typeof(effective_capabilities) = 'array'),
  -- Each term of the intersection as it was resolved: definition, target, runtime, entitlement.
  rights JSONB NOT NULL CHECK (jsonb_typeof(rights) = 'object'),
  memory_namespace TEXT NOT NULL CHECK (length(memory_namespace) BETWEEN 1 AND 512),
  admitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (actor_user_id, client_id, operation_id),
  FOREIGN KEY (agent_resource_id, agent_version) REFERENCES workforce_agent_versions(resource_id, version) ON DELETE RESTRICT,
  FOREIGN KEY (team_id, team_kind) REFERENCES workforce_resources(id, kind) ON DELETE RESTRICT,

  CONSTRAINT workforce_run_admission_target CHECK (CASE target_kind
    WHEN 'personal' THEN target_owner_user_id IS NOT NULL AND target_workspace_id IS NULL AND project_id IS NULL
      AND assignment_id IS NULL AND participation_id IS NULL
    WHEN 'workspace' THEN target_owner_user_id IS NULL AND target_workspace_id IS NOT NULL AND project_id IS NULL
      AND assignment_id IS NOT NULL AND assignment_revision IS NOT NULL AND participation_id IS NULL
    WHEN 'project' THEN project_id IS NOT NULL AND participation_id IS NOT NULL AND participation_revision IS NOT NULL
      AND num_nonnulls(target_owner_user_id, target_workspace_id) = 1
  END),
  CONSTRAINT workforce_run_admission_team CHECK (
    (team_id IS NULL AND team_kind IS NULL AND team_membership_id IS NULL AND team_membership_revision IS NULL
       AND member_set_revision IS NULL AND team_function IS NULL)
    -- A team acts only through an assignment's admitted member set (D21), so a team run always names
    -- one, and a team on a personal target -- where there is no assignment -- is unrepresentable.
    OR (team_id IS NOT NULL AND team_kind = 'team' AND team_membership_id IS NOT NULL AND team_membership_revision IS NOT NULL
       AND team_function IS NOT NULL AND member_set_revision IS NOT NULL AND assignment_id IS NOT NULL)),
  CONSTRAINT workforce_run_admission_root CHECK (
    num_nonnulls(root_binding_id, root_binding_revision, host_installation_id) IN (0, 3)
    AND (root_binding_id IS NULL OR target_kind = 'project')),
  -- RUN-02 as a database fact: nothing effective that any recorded term withheld.
  CONSTRAINT workforce_run_admission_intersection CHECK (
    rights ?& ARRAY['definition','target','runtime','entitlement']
    AND jsonb_typeof(rights->'definition') = 'array' AND jsonb_typeof(rights->'target') = 'array'
    AND jsonb_typeof(rights->'runtime') IN ('array','null') AND jsonb_typeof(rights->'entitlement') IN ('array','null')
    AND effective_capabilities <@ requested_capabilities
    AND effective_capabilities <@ (rights->'definition')
    AND effective_capabilities <@ (rights->'target')
    AND (jsonb_typeof(rights->'runtime') = 'null' OR effective_capabilities <@ (rights->'runtime'))
    AND (jsonb_typeof(rights->'entitlement') = 'null' OR effective_capabilities <@ (rights->'entitlement'))),
  CONSTRAINT workforce_run_admission_entitlement CHECK ((entitlement_id IS NULL) = (jsonb_typeof(rights->'entitlement') = 'null'))
);
CREATE INDEX workforce_run_admissions_agent ON workforce_run_admissions(agent_resource_id, admitted_at DESC);
CREATE INDEX workforce_run_admissions_assignment ON workforce_run_admissions(assignment_id) WHERE assignment_id IS NOT NULL;
CREATE INDEX workforce_run_admissions_participation ON workforce_run_admissions(participation_id) WHERE participation_id IS NOT NULL;
COMMENT ON TABLE workforce_run_admissions IS
  'RUN-01/RUN-02: one run''s admission -- resolved from authoritative state, the intersection of every right it runs under. Immutable.';

CREATE FUNCTION workforce_run_admission_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'a run admission is immutable and retained; admit again instead' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER workforce_run_admissions_immutable BEFORE UPDATE OR DELETE ON workforce_run_admissions
  FOR EACH ROW EXECUTE FUNCTION workforce_run_admission_immutable();
CREATE TRIGGER workforce_run_admissions_no_truncate BEFORE TRUNCATE ON workforce_run_admissions
  FOR EACH STATEMENT EXECUTE FUNCTION workforce_run_admission_immutable();

DO $harden$
BEGIN
  EXECUTE format('ALTER FUNCTION %I.workforce_run_admission_immutable() SET search_path = %I, pg_temp',
    current_schema(), current_schema());
END $harden$;

-- DOWN
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM workforce_run_admissions) THEN
    RAISE EXCEPTION 'run admission rollback refused: retained admissions exist' USING ERRCODE = '23514';
  END IF;
END $$;
DROP TABLE workforce_run_admissions;
DROP FUNCTION workforce_run_admission_immutable();
