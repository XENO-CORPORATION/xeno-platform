-- UP
-- XENO-WORKFORCE-01 ASN-05. These records establish membership/snapshot
-- integrity, NEVER human authorization, resource-use rights or execution grants.
-- Mutation service lock order: sorted workspace authority advisory gates, then
-- those workspace rows, then resources/team, then assignment/member rows.
-- Acquire context locks BEFORE issuing UPDATEs (PostgreSQL itself locks the
-- updated row before a BEFORE ROW trigger). No network I/O within transactions.

ALTER TABLE workforce_resources ADD COLUMN team_membership_revision BIGINT;
UPDATE workforce_resources SET team_membership_revision=1 WHERE kind='team';
ALTER TABLE workforce_resources ADD CONSTRAINT workforce_resource_team_revision CHECK (
  (kind='team' AND team_membership_revision IS NOT NULL AND team_membership_revision>0)
  OR (kind='agent' AND team_membership_revision IS NULL)
);
CREATE FUNCTION workforce_team_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.kind='team' THEN
      IF NEW.team_membership_revision IS NOT NULL AND NEW.team_membership_revision<>1 THEN RAISE EXCEPTION 'initial team membership revision must be one' USING ERRCODE='23514'; END IF;
      NEW.team_membership_revision:=1;
    END IF;
  ELSIF NEW.team_membership_revision IS DISTINCT FROM OLD.team_membership_revision THEN
    IF pg_trigger_depth()<2 OR NEW.kind<>'team' OR NEW.team_membership_revision<>OLD.team_membership_revision+1
      OR (to_jsonb(NEW)-'team_membership_revision') IS DISTINCT FROM (to_jsonb(OLD)-'team_membership_revision') THEN
      RAISE EXCEPTION 'team membership revision changes only with canonical membership mutation' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workforce_resources_team_revision BEFORE INSERT OR UPDATE ON workforce_resources FOR EACH ROW EXECUTE FUNCTION workforce_team_revision_guard();

-- Shared persistence lock, not an authorization function. Re-read the resource
-- after locking; a source-owner change cannot silently change the lock scope.
CREATE FUNCTION workforce_lock_resource_context(resource_uuid UUID, target_workspace UUID DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE source_workspace UUID; current_source UUID; workspace_uuid UUID;
BEGIN
  SELECT owner_workspace_id INTO source_workspace FROM workforce_resources WHERE id=resource_uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'workforce resource unavailable' USING ERRCODE='23503'; END IF;
  FOR workspace_uuid IN SELECT DISTINCT scope FROM unnest(ARRAY[source_workspace,target_workspace]) scope WHERE scope IS NOT NULL ORDER BY scope LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('workspace-authority-operations:'||workspace_uuid::text,0));
  END LOOP;
  PERFORM id FROM workspaces WHERE id=ANY(ARRAY[source_workspace,target_workspace]) ORDER BY id FOR SHARE;
  SELECT owner_workspace_id INTO current_source FROM workforce_resources WHERE id=resource_uuid FOR UPDATE;
  IF NOT FOUND OR current_source IS DISTINCT FROM source_workspace THEN RAISE EXCEPTION 'workforce resource owner changed during lock admission' USING ERRCODE='23514'; END IF;
END $$;

CREATE TABLE workforce_team_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL,
  team_kind TEXT NOT NULL DEFAULT 'team' CHECK (team_kind='team'),
  member_resource_id UUID,
  member_resource_kind TEXT CHECK (member_resource_kind='agent'),
  -- SET NULL, not RESTRICT. RESTRICT made a membership pin the person's account
  -- against deletion forever, so anyone ever added to a team could never be
  -- erased -- the opposite of the erasure behaviour the sibling migration ships
  -- for creators. The tombstone below keeps the row's meaning after the id goes.
  member_principal_id UUID REFERENCES users(id) ON DELETE SET NULL,
  member_principal_erased_at TIMESTAMPTZ,
  -- XENO-WORKFORCE-01 ROLE-02: the TEAM FUNCTION, and there are exactly three.
  -- This was a free-form VARCHAR(128) defaulting to 'member' -- a value ROLE-02 does not define
  -- and nothing could map later. Enumerating it is only cheap while this migration is unapplied:
  -- once rows exist, an arbitrary string column cannot be narrowed without deciding what every
  -- written value meant.
  --
  -- It is a FUNCTION, not a permission (ROLE-01): it says what a member is FOR, never what it may
  -- DO. The platform role (users.role) and the workspace ReBAC role are two separate axes, and an
  -- `observer` who separately holds workspace-admin is a normal, representable state.
  --
  -- NO DEFAULT, deliberately. A default makes the least-considered choice the automatic one, and
  -- ROLE-02 gives `manager` real authority (admit/remove members, approve child dispatch). An
  -- omitted function should fail the insert, not silently pick one.
  role TEXT NOT NULL CHECK (role IN ('manager','worker','observer')),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision>0),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','revoked')),
  joined_team_revision BIGINT NOT NULL CHECK (joined_team_revision>0),
  changed_team_revision BIGINT NOT NULL CHECK (changed_team_revision>=joined_team_revision),
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  FOREIGN KEY(team_id,team_kind) REFERENCES workforce_resources(id,kind) ON DELETE RESTRICT,
  FOREIGN KEY(member_resource_id,member_resource_kind) REFERENCES workforce_resources(id,kind) ON DELETE RESTRICT,
  UNIQUE(team_id,id),
  -- Three legal shapes, not two: an agent member, a live human member, and a
  -- human member whose account has been erased. The third exists so erasure has
  -- somewhere to land; without it ON DELETE SET NULL would violate the XOR and
  -- the deletion would fail anyway, which is how RESTRICT got chosen originally.
  CHECK ((member_resource_id IS NOT NULL AND member_resource_kind IS NOT NULL AND member_principal_id IS NULL AND member_principal_erased_at IS NULL)
    OR (member_resource_id IS NULL AND member_resource_kind IS NULL AND member_principal_id IS NOT NULL AND member_principal_erased_at IS NULL)
    OR (member_resource_id IS NULL AND member_resource_kind IS NULL AND member_principal_id IS NULL AND member_principal_erased_at IS NOT NULL)),
  CHECK ((state='active' AND revoked_at IS NULL) OR (state='revoked' AND revoked_at IS NOT NULL AND revoked_at>=created_at))
);
CREATE UNIQUE INDEX workforce_team_active_resource ON workforce_team_memberships(team_id,member_resource_id) WHERE state='active' AND member_resource_id IS NOT NULL;
CREATE UNIQUE INDEX workforce_team_active_principal ON workforce_team_memberships(team_id,member_principal_id) WHERE state='active' AND member_principal_id IS NOT NULL;
CREATE INDEX workforce_team_membership_state ON workforce_team_memberships(team_id,state,id);
CREATE INDEX workforce_team_membership_creator ON workforce_team_memberships(created_by_user_id) WHERE created_by_user_id IS NOT NULL;

CREATE FUNCTION workforce_team_membership_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE next_team_revision BIGINT; team_status TEXT;
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'team membership history is retained; revoke instead' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    IF to_jsonb(NEW)=to_jsonb(OLD) THEN RETURN NEW; END IF;
    IF NEW.created_by_user_id IS NULL AND OLD.created_by_user_id IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.created_by_user_id)
      AND (to_jsonb(NEW)-'created_by_user_id')=(to_jsonb(OLD)-'created_by_user_id') THEN RETURN NEW; END IF;
    -- Account erasure of a human MEMBER, the same shape as the creator hatch
    -- above: only when the user row is already gone and nothing else moved. The
    -- tombstone is stamped here rather than by the FK, because a referential
    -- action can null a column but cannot record that it did.
    IF NEW.member_principal_id IS NULL AND OLD.member_principal_id IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.member_principal_id)
      AND (to_jsonb(NEW)-'member_principal_id')=(to_jsonb(OLD)-'member_principal_id') THEN
      NEW.member_principal_erased_at:=now(); RETURN NEW;
    END IF;
    IF ROW(NEW.id,NEW.team_id,NEW.team_kind,NEW.member_resource_id,NEW.member_resource_kind,NEW.member_principal_id,NEW.member_principal_erased_at,NEW.created_by_user_id,NEW.created_at,NEW.joined_team_revision)
      IS DISTINCT FROM ROW(OLD.id,OLD.team_id,OLD.team_kind,OLD.member_resource_id,OLD.member_resource_kind,OLD.member_principal_id,OLD.member_principal_erased_at,OLD.created_by_user_id,OLD.created_at,OLD.joined_team_revision) THEN
      RAISE EXCEPTION 'membership endpoints and creator are immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.state='revoked' OR NEW.revision<>OLD.revision+1 OR NEW.updated_at<OLD.updated_at
      OR NEW.changed_team_revision<>OLD.changed_team_revision OR (NEW.state='revoked' AND NEW.role<>OLD.role) THEN
      RAISE EXCEPTION 'invalid membership state or revision transition' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.state<>'active' OR NEW.revision<>1 OR NEW.joined_team_revision IS NOT NULL OR NEW.changed_team_revision IS NOT NULL
    OR NEW.member_principal_erased_at IS NOT NULL THEN
    RAISE EXCEPTION 'membership must start active with generated team revisions' USING ERRCODE='23514';
  END IF;
  PERFORM workforce_lock_resource_context(NEW.team_id);
  SELECT team_membership_revision+1, status INTO next_team_revision, team_status FROM workforce_resources WHERE id=NEW.team_id AND kind='team';
  IF NOT FOUND THEN RAISE EXCEPTION 'membership requires canonical team resource' USING ERRCODE='23514'; END IF;
  -- OWN-06: archive blocks NEW admissions. Revocation stays available on an
  -- archived team, because removing a member must never require un-archiving --
  -- that would force a team back into a state where it can be assigned again.
  IF team_status<>'active' AND NOT (TG_OP='UPDATE' AND NEW.state='revoked' AND OLD.state='active') THEN
    RAISE EXCEPTION 'archived team admits no new or altered members' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN NEW.joined_team_revision:=next_team_revision; END IF;
  NEW.changed_team_revision:=next_team_revision;
  RETURN NEW;
END $$;
CREATE TRIGGER workforce_team_memberships_guard BEFORE INSERT OR UPDATE OR DELETE ON workforce_team_memberships FOR EACH ROW EXECUTE FUNCTION workforce_team_membership_guard();
CREATE TRIGGER workforce_team_memberships_no_truncate BEFORE TRUNCATE ON workforce_team_memberships FOR EACH STATEMENT EXECUTE FUNCTION workforce_team_membership_guard();
CREATE FUNCTION workforce_team_membership_advance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' OR ROW(NEW.revision,NEW.role,NEW.state) IS DISTINCT FROM ROW(OLD.revision,OLD.role,OLD.state) THEN
    UPDATE workforce_resources SET team_membership_revision=team_membership_revision+1 WHERE id=NEW.team_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER workforce_team_memberships_advance AFTER INSERT OR UPDATE ON workforce_team_memberships FOR EACH ROW EXECUTE FUNCTION workforce_team_membership_advance();

-- Explicit descriptor distinguishes an empty approved set from an absent set.
CREATE TABLE workforce_assignment_member_sets (
  assignment_id UUID NOT NULL,
  snapshot_revision BIGINT NOT NULL CHECK(snapshot_revision>0),
  team_id UUID NOT NULL,
  team_kind TEXT NOT NULL DEFAULT 'team' CHECK(team_kind='team'),
  workspace_id UUID NOT NULL,
  team_membership_revision BIGINT NOT NULL CHECK(team_membership_revision>0),
  member_count INTEGER NOT NULL CHECK(member_count BETWEEN 0 AND 256),
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- D02: "later members require target admission". A later member set is captured
  -- by the source and only becomes effective when the TARGET admits it here, which
  -- is a distinct act from the original acceptance and is attributed separately.
  admitted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  admitted_at TIMESTAMPTZ,
  PRIMARY KEY(assignment_id,snapshot_revision),
  -- No UNIQUE(assignment_id). It contradicted the primary key: with one snapshot
  -- per assignment forever, snapshot_revision could never take a second value and
  -- D02 re-admission was structurally impossible -- a later member could only be
  -- added by revoking and re-proposing, which is a NEW grant needing fresh source
  -- approval, not the admission D02 describes.
  -- Attribution at admission time is required by the guard, not by a CHECK: the
  -- admitting account can later be erased, so "admitted_by is present" is not an
  -- invariant of the row, only of the moment it was admitted.
  UNIQUE(assignment_id,snapshot_revision,team_id),
  FOREIGN KEY(team_id,team_kind) REFERENCES workforce_resources(id,kind) ON DELETE RESTRICT,
  FOREIGN KEY(team_id,workspace_id,assignment_id) REFERENCES workforce_workspace_assignments(resource_id,workspace_id,id) ON DELETE RESTRICT
);
CREATE INDEX workforce_assignment_member_sets_creator ON workforce_assignment_member_sets(created_by_user_id) WHERE created_by_user_id IS NOT NULL;
CREATE TABLE workforce_assignment_members (
  assignment_id UUID NOT NULL,
  snapshot_revision BIGINT NOT NULL,
  team_id UUID NOT NULL,
  membership_id UUID NOT NULL,
  membership_revision BIGINT NOT NULL CHECK(membership_revision>0),
  -- Same vocabulary as the membership row this snapshot pins (ROLE-02). The constraint is
  -- repeated rather than inherited: this table is compared against the membership on every
  -- admission check, and a snapshot that could hold a function the membership cannot would make
  -- those comparisons silently unsatisfiable.
  role TEXT NOT NULL CHECK (role IN ('manager','worker','observer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(assignment_id,snapshot_revision,membership_id),
  FOREIGN KEY(assignment_id,snapshot_revision,team_id) REFERENCES workforce_assignment_member_sets(assignment_id,snapshot_revision,team_id) ON DELETE RESTRICT,
  FOREIGN KEY(team_id,membership_id) REFERENCES workforce_team_memberships(team_id,id) ON DELETE RESTRICT
);
CREATE INDEX workforce_assignment_members_membership ON workforce_assignment_members(membership_id,assignment_id);

CREATE FUNCTION workforce_member_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assignment workforce_workspace_assignments%ROWTYPE; descriptor workforce_assignment_member_sets%ROWTYPE; team_status TEXT;
  membership workforce_team_memberships%ROWTYPE; current_revision BIGINT; count_members INTEGER;
  is_initial BOOLEAN; is_later BOOLEAN;
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'approved member snapshots are immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    IF TG_TABLE_NAME='workforce_assignment_member_sets' THEN
      IF NEW.created_by_user_id IS NULL AND OLD.created_by_user_id IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.created_by_user_id)
        AND (to_jsonb(NEW)-'created_by_user_id')=(to_jsonb(OLD)-'created_by_user_id') THEN RETURN NEW; END IF;
      IF NEW.admitted_by_user_id IS NULL AND OLD.admitted_by_user_id IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.admitted_by_user_id)
        AND (to_jsonb(NEW)-'admitted_by_user_id')=(to_jsonb(OLD)-'admitted_by_user_id') THEN RETURN NEW; END IF;
      -- The ONE permitted mutation: the target admits a captured later member set.
      -- Everything else about an approved snapshot stays immutable, so this cannot
      -- become a general edit path -- the jsonb comparison pins every other column.
      IF OLD.admitted_at IS NULL AND NEW.admitted_at IS NOT NULL AND NEW.admitted_by_user_id IS NOT NULL
        AND (to_jsonb(NEW)-'admitted_at'-'admitted_by_user_id')=(to_jsonb(OLD)-'admitted_at'-'admitted_by_user_id') THEN
        SELECT * INTO assignment FROM workforce_workspace_assignments WHERE id=NEW.assignment_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'assignment missing for member snapshot' USING ERRCODE='23503'; END IF;
        PERFORM workforce_lock_resource_context(assignment.resource_id,assignment.workspace_id);
        SELECT * INTO assignment FROM workforce_workspace_assignments WHERE id=NEW.assignment_id;
        IF assignment.state<>'accepted' OR assignment.revoked_at IS NOT NULL
          OR NEW.snapshot_revision<=assignment.member_set_revision THEN
          RAISE EXCEPTION 'only a later member set on a live accepted assignment can be admitted' USING ERRCODE='23514';
        END IF;
        -- Completeness and currency to the same standard as first acceptance: a
        -- later admission must not be a weaker gate than the original one.
        SELECT count(*) INTO count_members FROM workforce_assignment_members
          WHERE assignment_id=NEW.assignment_id AND snapshot_revision=NEW.snapshot_revision;
        -- Aliased `tm`, not `membership`: this function DECLAREs a `membership`
        -- rowtype variable, and PL/pgSQL resolves the variable first, so the
        -- obvious alias makes every column reference ambiguous at runtime.
        IF count_members<>NEW.member_count OR EXISTS(
          SELECT 1 FROM workforce_assignment_members admitted
          JOIN workforce_team_memberships tm ON tm.id=admitted.membership_id AND tm.team_id=admitted.team_id
          WHERE admitted.assignment_id=NEW.assignment_id AND admitted.snapshot_revision=NEW.snapshot_revision
            AND (tm.state<>'active' OR tm.revision<>admitted.membership_revision OR tm.role<>admitted.role)
        ) THEN RAISE EXCEPTION 'admitted member set is incomplete or no longer current' USING ERRCODE='23514'; END IF;
        RETURN NEW;
      END IF;
    END IF;
    RAISE EXCEPTION 'approved member snapshots are immutable' USING ERRCODE='23514';
  END IF;
  SELECT * INTO assignment FROM workforce_workspace_assignments WHERE id=NEW.assignment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'assignment missing for member snapshot' USING ERRCODE='23503'; END IF;
  PERFORM workforce_lock_resource_context(assignment.resource_id,assignment.workspace_id);
  SELECT * INTO assignment FROM workforce_workspace_assignments WHERE id=NEW.assignment_id;
  IF assignment.resource_kind<>'team' OR assignment.resource_id<>NEW.team_id THEN
    RAISE EXCEPTION 'snapshot must belong to its team assignment' USING ERRCODE='23514';
  END IF;
  -- Two legal capture windows. The first is the original approved set, written
  -- before source approval. The second is a LATER set on an assignment that is
  -- already live, which is how D02's "later members require target admission" is
  -- expressed: the source captures it, the target admits it separately, and until
  -- it is admitted it changes nothing about who is effective.
  is_initial := (assignment.state='proposed' AND assignment.source_approved_at IS NULL
    AND assignment.member_set_revision IS NOT DISTINCT FROM NEW.snapshot_revision);
  is_later := (assignment.state='accepted' AND assignment.revoked_at IS NULL
    AND NEW.snapshot_revision>assignment.member_set_revision);
  IF NOT (is_initial OR is_later) THEN
    RAISE EXCEPTION 'snapshot must match an unapproved team proposal or a live accepted assignment' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='workforce_assignment_member_sets' THEN
    -- A captured set is never born admitted; admission is a separate act by the
    -- target, so a source that could write it here would be admitting itself.
    IF NEW.admitted_at IS NOT NULL OR NEW.admitted_by_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'a member set is captured unadmitted; admission is a separate act' USING ERRCODE='23514';
    END IF;
    -- Revisions are consecutive, so a gap cannot be used to skip an intervening
    -- member set that was captured and never admitted.
    IF is_later AND NEW.snapshot_revision<>COALESCE((SELECT max(snapshot_revision) FROM workforce_assignment_member_sets
      WHERE assignment_id=NEW.assignment_id),0)+1 THEN
      RAISE EXCEPTION 'a later member set must be the next snapshot revision' USING ERRCODE='23514';
    END IF;
    SELECT team_membership_revision, status INTO current_revision, team_status FROM workforce_resources WHERE id=NEW.team_id;
    IF NEW.workspace_id<>assignment.workspace_id OR NEW.team_membership_revision<>current_revision THEN
      RAISE EXCEPTION 'snapshot descriptor membership revision or workspace mismatch' USING ERRCODE='23514';
    END IF;
    -- OWN-06 again, on the capture side: an archived team must not be able to
    -- enter a new approved member set. Acceptance itself is already refused for a
    -- non-active resource by the sibling migration's guard, so this closes the
    -- half that runs BEFORE acceptance.
    IF team_status<>'active' THEN
      RAISE EXCEPTION 'archived team cannot enter an approved member set' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT * INTO descriptor FROM workforce_assignment_member_sets WHERE assignment_id=NEW.assignment_id AND snapshot_revision=NEW.snapshot_revision;
    IF NOT FOUND THEN RAISE EXCEPTION 'explicit snapshot descriptor required' USING ERRCODE='23503'; END IF;
    SELECT * INTO membership FROM workforce_team_memberships WHERE team_id=NEW.team_id AND id=NEW.membership_id;
    IF NOT FOUND OR membership.state<>'active' OR membership.revision<>NEW.membership_revision OR membership.role<>NEW.role
      OR membership.changed_team_revision>descriptor.team_membership_revision THEN
      RAISE EXCEPTION 'snapshot member is not the captured active team membership' USING ERRCODE='23514';
    END IF;
    SELECT count(*) INTO count_members FROM workforce_assignment_members WHERE assignment_id=NEW.assignment_id AND snapshot_revision=NEW.snapshot_revision;
    IF count_members>=descriptor.member_count THEN RAISE EXCEPTION 'snapshot exceeds explicit member count' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workforce_assignment_member_sets_guard BEFORE INSERT OR UPDATE OR DELETE ON workforce_assignment_member_sets FOR EACH ROW EXECUTE FUNCTION workforce_member_snapshot_guard();
CREATE TRIGGER workforce_assignment_member_sets_no_truncate BEFORE TRUNCATE ON workforce_assignment_member_sets FOR EACH STATEMENT EXECUTE FUNCTION workforce_member_snapshot_guard();
CREATE TRIGGER workforce_assignment_members_guard BEFORE INSERT OR UPDATE OR DELETE ON workforce_assignment_members FOR EACH ROW EXECUTE FUNCTION workforce_member_snapshot_guard();
CREATE TRIGGER workforce_assignment_members_no_truncate BEFORE TRUNCATE ON workforce_assignment_members FOR EACH STATEMENT EXECUTE FUNCTION workforce_member_snapshot_guard();

-- Alphabetical BEFORE trigger order matters: obtain workspace-first context
-- before the older resource/target checks. Their subsequent locks are reentrant,
-- so this migration does not retain a resource->workspace acquisition inversion.
CREATE FUNCTION workforce_assignment_member_admission_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE descriptor workforce_assignment_member_sets%ROWTYPE; actual_count INTEGER;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.resource_kind='team' AND NEW.source_approved_at IS NOT NULL THEN RAISE EXCEPTION 'team source approval requires persisted member descriptor first' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF NOT ((OLD.source_approved_at IS NULL AND NEW.source_approved_at IS NOT NULL) OR (OLD.state='proposed' AND NEW.state='accepted')) THEN RETURN NEW; END IF;
  PERFORM workforce_lock_resource_context(NEW.resource_id,NEW.workspace_id);
  IF NEW.resource_kind='team' THEN
    SELECT * INTO descriptor FROM workforce_assignment_member_sets WHERE assignment_id=NEW.id AND snapshot_revision=NEW.member_set_revision;
    IF NOT FOUND OR descriptor.team_id<>NEW.resource_id OR descriptor.workspace_id<>NEW.workspace_id THEN
      RAISE EXCEPTION 'team approval requires explicit matching member descriptor' USING ERRCODE='23514';
    END IF;
    SELECT count(*) INTO actual_count FROM workforce_assignment_members WHERE assignment_id=NEW.id AND snapshot_revision=NEW.member_set_revision;
    IF actual_count<>descriptor.member_count OR EXISTS(
      SELECT 1 FROM workforce_assignment_members admitted
      JOIN workforce_team_memberships membership ON membership.id=admitted.membership_id AND membership.team_id=admitted.team_id
      WHERE admitted.assignment_id=NEW.id AND admitted.snapshot_revision=NEW.member_set_revision
        AND (membership.state<>'active' OR membership.revision<>admitted.membership_revision OR membership.role<>admitted.role)
    ) THEN RAISE EXCEPTION 'team approval member set is incomplete or no longer current' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER a_workforce_assignment_member_admission BEFORE INSERT OR UPDATE ON workforce_workspace_assignments FOR EACH ROW EXECUTE FUNCTION workforce_assignment_member_admission_guard();

-- Pin pg_temp LAST on every guard. This is not hygiene; it is the only thing
-- that makes the trigger logic above as strong as the CHECK constraint dropped
-- at the end of this migration. PostgreSQL searches pg_temp FIRST for relation
-- names, and these are SECURITY INVOKER functions, so without this any caller
-- able to CREATE TEMP TABLE substitutes its own workforce_assignment_member_sets
-- and is admitted with no real member set at all -- verified against a real
-- fixture before this was added. A CHECK constraint could not be fooled that
-- way, so omitting this makes the replacement strictly weaker than what it
-- replaces. pg_catalog stays implicitly first because it is not named.
-- Resolved from current_schema() so it holds wherever the migration is applied.
DO $harden$
DECLARE fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'workforce_team_revision_guard()',
    'workforce_lock_resource_context(uuid,uuid)',
    'workforce_team_membership_guard()',
    'workforce_team_membership_advance()',
    'workforce_member_snapshot_guard()',
    'workforce_assignment_member_admission_guard()'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%s SET search_path = %I, pg_temp', current_schema(), fn, current_schema());
  END LOOP;
END $harden$;

-- Membership eligibility projection ONLY. Consumers still enforce current
-- principal usability, source/target authority, resource-use consent, policy,
-- entitlement, scope/admission lease and payer. This view grants none of them.
CREATE VIEW workforce_assignment_active_member_candidates AS
SELECT assignment.id AS assignment_id,assignment.workspace_id,assignment.resource_id AS team_id,
  admitted.snapshot_revision,admitted.membership_id,admitted.membership_revision,admitted.role,
  membership.member_resource_id,membership.member_principal_id
FROM workforce_workspace_assignments assignment
JOIN workforce_resources team ON team.id=assignment.resource_id AND team.kind='team' AND team.status='active'
-- The effective set is the assignment's originally accepted one, or a LATER one
-- the target has since admitted. Taking the highest CAPTURED revision instead
-- would let the source widen the grant by writing a snapshot nobody admitted.
JOIN LATERAL (SELECT GREATEST(assignment.member_set_revision, COALESCE((SELECT max(later.snapshot_revision)
  FROM workforce_assignment_member_sets later
  WHERE later.assignment_id=assignment.id AND later.admitted_at IS NOT NULL),0)) AS snapshot_revision) effective ON TRUE
JOIN workforce_assignment_member_sets descriptor ON descriptor.assignment_id=assignment.id AND descriptor.snapshot_revision=effective.snapshot_revision
JOIN workforce_assignment_members admitted ON admitted.assignment_id=descriptor.assignment_id AND admitted.snapshot_revision=descriptor.snapshot_revision
JOIN workforce_team_memberships membership ON membership.id=admitted.membership_id AND membership.team_id=admitted.team_id
WHERE assignment.state='accepted' AND assignment.valid_from<=now() AND (assignment.valid_until IS NULL OR assignment.valid_until>now())
  AND team.owner_user_id IS NOT DISTINCT FROM assignment.source_owner_user_id
  AND team.owner_workspace_id IS NOT DISTINCT FROM assignment.source_owner_workspace_id
  AND membership.state='active' AND membership.revision=admitted.membership_revision AND membership.role=admitted.role;

-- Remove the temporary block LAST, after explicit empty/nonempty snapshots and
-- live individual-membership checks protect both source approval and acceptance.
ALTER TABLE workforce_workspace_assignments DROP CONSTRAINT workforce_assignment_team_admission_pending;

-- DOWN
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM workforce_team_memberships) OR EXISTS(SELECT 1 FROM workforce_assignment_member_sets) THEN
    RAISE EXCEPTION 'membership snapshot rollback refused: retained records exist' USING ERRCODE='23514';
  END IF;
END $$;
ALTER TABLE workforce_workspace_assignments ADD CONSTRAINT workforce_assignment_team_admission_pending CHECK(resource_kind<>'team' OR accepted_at IS NULL);
DROP VIEW workforce_assignment_active_member_candidates;
DROP TRIGGER a_workforce_assignment_member_admission ON workforce_workspace_assignments;
DROP FUNCTION workforce_assignment_member_admission_guard();
DROP TABLE workforce_assignment_members;
DROP TABLE workforce_assignment_member_sets;
DROP FUNCTION workforce_member_snapshot_guard();
DROP TABLE workforce_team_memberships;
DROP FUNCTION workforce_team_membership_advance();
DROP FUNCTION workforce_team_membership_guard();
DROP FUNCTION workforce_lock_resource_context(UUID,UUID);
DROP TRIGGER workforce_resources_team_revision ON workforce_resources;
DROP FUNCTION workforce_team_revision_guard();
ALTER TABLE workforce_resources DROP CONSTRAINT workforce_resource_team_revision;
ALTER TABLE workforce_resources DROP COLUMN team_membership_revision;
