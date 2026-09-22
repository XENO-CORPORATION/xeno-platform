-- UP
-- XENO-WORKFORCE-01 WS-02 foundation. Ownership is a source snapshot, not a
-- workspace parent edge. No assignments/backfills/ReBAC tuples are synthesized.
CREATE FUNCTION workforce_assignment_policy_valid(value JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE capability JSONB; seen TEXT[] := '{}'; name TEXT;
BEGIN
  IF value IS NULL OR jsonb_typeof(value) <> 'object' OR octet_length(value::text) > 16384 THEN RETURN FALSE; END IF;
  IF NOT (value ?& ARRAY['schemaVersion','mode','capabilities'])
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(value) AS field WHERE field NOT IN ('schemaVersion','mode','capabilities'))
     OR value->'schemaVersion' <> '1'::jsonb OR jsonb_typeof(value->'mode') <> 'string' OR value->>'mode' NOT IN ('none','explicit')
     OR jsonb_typeof(value->'capabilities') <> 'array' THEN RETURN FALSE; END IF;
  IF jsonb_array_length(value->'capabilities') > 64
     OR (value->>'mode' = 'none' AND jsonb_array_length(value->'capabilities') <> 0) THEN RETURN FALSE; END IF;
  FOR capability IN SELECT jsonb_array_elements(value->'capabilities') LOOP
    IF jsonb_typeof(capability) <> 'string' THEN RETURN FALSE; END IF;
    name := capability #>> '{}';
    IF name !~ '^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,127}$' OR name = 'all' OR name = ANY(seen) THEN RETURN FALSE; END IF;
    seen := array_append(seen, name);
  END LOOP;
  RETURN TRUE;
END;
$$;

CREATE TABLE workforce_workspace_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id UUID NOT NULL,
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('agent','team')),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  source_owner_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  source_owner_workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT,
  resource_revision BIGINT NOT NULL CHECK (resource_revision > 0),
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  source_approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  target_accepted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  source_approved_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  state TEXT NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed','accepted','revoked')),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  policy JSONB NOT NULL CHECK (workforce_assignment_policy_valid(policy)),
  -- A revision alone is NOT an admitted member set. This foundation can record
  -- team proposals but cannot accept one until immutable admitted-member rows
  -- and canonical team membership are implemented in their own migration.
  member_set_revision BIGINT CHECK (member_set_revision > 0),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (resource_id, resource_kind) REFERENCES workforce_resources(id, kind) ON DELETE RESTRICT,
  UNIQUE (resource_id, workspace_id, id),
  CONSTRAINT workforce_assignment_source_owner CHECK (num_nonnulls(source_owner_user_id,source_owner_workspace_id) = 1),
  CONSTRAINT workforce_assignment_validity CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT workforce_assignment_direct_agent CHECK (resource_kind <> 'agent' OR member_set_revision IS NULL),
  CONSTRAINT workforce_assignment_team_admission_pending CHECK (resource_kind <> 'team' OR accepted_at IS NULL),
  CONSTRAINT workforce_assignment_source_attribution CHECK (source_approved_by_user_id IS NULL OR source_approved_at IS NOT NULL),
  CONSTRAINT workforce_assignment_target_attribution CHECK (target_accepted_by_user_id IS NULL OR accepted_at IS NOT NULL),
  CONSTRAINT workforce_assignment_state_fields CHECK (
    (state = 'proposed' AND accepted_at IS NULL AND revoked_at IS NULL)
    OR (state = 'accepted' AND source_approved_at IS NOT NULL AND accepted_at IS NOT NULL AND revoked_at IS NULL)
    OR (state = 'revoked' AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT workforce_assignment_approval_order CHECK (accepted_at IS NULL OR (source_approved_at IS NOT NULL AND accepted_at >= source_approved_at)),
  CONSTRAINT workforce_assignment_revocation_order CHECK (revoked_at IS NULL OR revoked_at >= COALESCE(accepted_at,created_at))
);
CREATE UNIQUE INDEX workforce_workspace_assignments_live_pair
  ON workforce_workspace_assignments(resource_id,workspace_id) WHERE state IN ('proposed','accepted');
CREATE INDEX workforce_workspace_assignments_target_catalog
  ON workforce_workspace_assignments(workspace_id,state,created_at DESC,id DESC);
CREATE INDEX workforce_workspace_assignments_resource_catalog
  ON workforce_workspace_assignments(resource_id,state,created_at DESC,id DESC);
CREATE INDEX workforce_workspace_assignments_creator ON workforce_workspace_assignments(created_by_user_id) WHERE created_by_user_id IS NOT NULL;
CREATE INDEX workforce_workspace_assignments_source_approver ON workforce_workspace_assignments(source_approved_by_user_id) WHERE source_approved_by_user_id IS NOT NULL;
CREATE INDEX workforce_workspace_assignments_target_acceptor ON workforce_workspace_assignments(target_accepted_by_user_id) WHERE target_accepted_by_user_id IS NOT NULL;

CREATE FUNCTION workforce_assignment_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE resource workforce_resources%ROWTYPE; target_status TEXT;
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'workforce assignment history is retained; revoke instead' USING ERRCODE='23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'proposed' OR NEW.revision <> 1 OR NEW.accepted_at IS NOT NULL OR NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'workforce assignments must first be proposed' USING ERRCODE='23514';
    END IF;
    IF NEW.source_approved_at IS NOT NULL AND NEW.source_approved_by_user_id IS NULL THEN
      RAISE EXCEPTION 'source approval requires attributable approver' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF to_jsonb(NEW) = to_jsonb(OLD) THEN RETURN NEW; END IF;
  -- FK user erasure clears only attribution, never ownership, revision, policy
  -- or timestamps. Direct caller attempts to clear a live identity fail below.
  IF (to_jsonb(NEW) - ARRAY['created_by_user_id','source_approved_by_user_id','target_accepted_by_user_id'])
      = (to_jsonb(OLD) - ARRAY['created_by_user_id','source_approved_by_user_id','target_accepted_by_user_id'])
    AND (NEW.created_by_user_id IS NOT DISTINCT FROM OLD.created_by_user_id OR (NEW.created_by_user_id IS NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.created_by_user_id)))
    AND (NEW.source_approved_by_user_id IS NOT DISTINCT FROM OLD.source_approved_by_user_id OR (NEW.source_approved_by_user_id IS NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.source_approved_by_user_id)))
    AND (NEW.target_accepted_by_user_id IS NOT DISTINCT FROM OLD.target_accepted_by_user_id OR (NEW.target_accepted_by_user_id IS NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.target_accepted_by_user_id))) THEN RETURN NEW;
  END IF;
  IF ROW(NEW.id,NEW.resource_id,NEW.resource_kind,NEW.workspace_id,NEW.source_owner_user_id,NEW.source_owner_workspace_id,NEW.created_by_user_id,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.resource_id,OLD.resource_kind,OLD.workspace_id,OLD.source_owner_user_id,OLD.source_owner_workspace_id,OLD.created_by_user_id,OLD.created_at) THEN
    RAISE EXCEPTION 'workforce assignment endpoints and origin are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.state = 'revoked' OR NEW.revision <> OLD.revision + 1 OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'workforce assignment state or revision cannot regress' USING ERRCODE='23514';
  END IF;
  IF OLD.source_approved_at IS NOT NULL AND ROW(NEW.source_approved_at,NEW.source_approved_by_user_id,NEW.resource_revision,NEW.policy,NEW.member_set_revision,NEW.valid_from,NEW.valid_until)
      IS DISTINCT FROM ROW(OLD.source_approved_at,OLD.source_approved_by_user_id,OLD.resource_revision,OLD.policy,OLD.member_set_revision,OLD.valid_from,OLD.valid_until) THEN
    RAISE EXCEPTION 'source-approved assignment terms are immutable; revoke and repropose' USING ERRCODE='23514';
  END IF;
  IF NEW.source_approved_at IS NOT NULL AND OLD.source_approved_at IS NULL AND NEW.source_approved_by_user_id IS NULL THEN
    RAISE EXCEPTION 'source approval requires attributable approver' USING ERRCODE='23514';
  END IF;
  IF OLD.state = 'accepted' AND (NEW.state <> 'revoked' OR ROW(NEW.accepted_at,NEW.target_accepted_by_user_id)
      IS DISTINCT FROM ROW(OLD.accepted_at,OLD.target_accepted_by_user_id)) THEN
    RAISE EXCEPTION 'accepted assignment can only be revoked without rewriting acceptance' USING ERRCODE='23514';
  END IF;
  IF OLD.state = 'proposed' AND NEW.state = 'revoked' AND (NEW.accepted_at IS NOT NULL OR NEW.target_accepted_by_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'revocation cannot invent prior acceptance' USING ERRCODE='23514';
  END IF;
  IF NEW.state = 'accepted' THEN
    IF NEW.source_approved_by_user_id IS NULL OR NEW.target_accepted_by_user_id IS NULL THEN
      RAISE EXCEPTION 'acceptance requires source and target approvers' USING ERRCODE='23514';
    END IF;
    IF NEW.valid_until IS NOT NULL AND NEW.valid_until <= clock_timestamp() THEN
      RAISE EXCEPTION 'expired assignment cannot be accepted' USING ERRCODE='23514';
    END IF;
    -- Snapshot integrity only, NOT human authorization. Services must use their
    -- canonical authority gates and lock these same rows in this declared order.
    SELECT * INTO resource FROM workforce_resources WHERE id=NEW.resource_id FOR SHARE;
    IF NOT FOUND OR resource.kind <> NEW.resource_kind OR resource.status <> 'active' OR resource.revision <> NEW.resource_revision
      OR resource.owner_user_id IS DISTINCT FROM NEW.source_owner_user_id
      OR resource.owner_workspace_id IS DISTINCT FROM NEW.source_owner_workspace_id THEN
      RAISE EXCEPTION 'resource owner or revision changed before assignment acceptance' USING ERRCODE='23514';
    END IF;
    SELECT status INTO target_status FROM workspaces WHERE id=NEW.workspace_id FOR SHARE;
    IF NOT FOUND OR target_status <> 'active' THEN
      RAISE EXCEPTION 'target workspace unavailable for assignment acceptance' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER workforce_workspace_assignments_guard
BEFORE INSERT OR UPDATE OR DELETE ON workforce_workspace_assignments FOR EACH ROW EXECUTE FUNCTION workforce_assignment_guard();
CREATE TRIGGER workforce_workspace_assignments_no_truncate
BEFORE TRUNCATE ON workforce_workspace_assignments FOR EACH STATEMENT EXECUTE FUNCTION workforce_assignment_guard();

-- DOWN
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM workforce_workspace_assignments) THEN
    RAISE EXCEPTION 'workforce assignment rollback refused: retained records exist' USING ERRCODE='23514';
  END IF;
END $$;
DROP TABLE workforce_workspace_assignments;
DROP FUNCTION workforce_assignment_guard();
DROP FUNCTION workforce_assignment_policy_valid(JSONB);
