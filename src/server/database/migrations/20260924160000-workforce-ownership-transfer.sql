-- UP
-- XENO-WORKFORCE-01 OWN-05 -- ownership transfer as a two-sided, reviewed, audited operation.
--
--   "Company-owned resources survive creator departure. Ownership transfer requires source
--    authorization, destination acceptance, dependency/license review and an auditable operation;
--    it never silently migrates secrets or active runs."
--
-- 20260923120000 made an owner change VISIBLE (it must advance the revision) and said in its own
-- header that building transfer -- "source authorization, destination acceptance,
-- dependency/licence review, an auditable operation" -- remained the product work it is. This is
-- that work. Until now an owner moved with one UPDATE: no counterparty, no review, no record.
--
-- ── WHAT THE DATABASE OWNS, AND WHAT THE SERVICE OWNS ─────────────────────────────────────────
-- WHO may authorize and who may accept is an authority question, answered by
-- services/workforceOwnershipTransfer.js against live ReBAC. This file owns the INTEGRITY: the
-- order of the acts, their attribution, what the review must contain, the preconditions of the
-- move, and the move itself. Neither half is sufficient alone, and the split is the one
-- workforce_workspace_assignments already uses ("snapshot integrity only, NOT human authorization").
--
-- ── THE FOUR REQUIREMENTS, EACH AS SOMETHING THAT CAN BE REFUSED ─────────────────────────────
--
--  SOURCE AUTHORIZATION, then DESTINATION ACCEPTANCE: separate acts, in order, each attributed and
--  timestamped. Nobody may hand a resource to somebody else, and nobody may help themselves to one.
--
--  DEPENDENCY/LICENCE REVIEW: the act that would ordinarily rot into a checkbox, so it is not a
--  boolean. It enumerates the secret references and licences the resource ACTUALLY declares, and
--  the guard compares that enumeration against the current definition. A review that omits a
--  secret the agent declares is REFUSED -- the reviewer cannot pass by not looking -- and a
--  definition version published after the review invalidates it at acceptance.
--
--  AN AUDITABLE OPERATION: acceptance carries a composite foreign key onto the workforce_operations
--  row that records it (LIFE-06/LIFE-07 -- who decided, under whose authority, why), so an accepted
--  transfer with no decision record is unrepresentable rather than merely checked. `resource.transfer`
--  joins that table's existing kinds instead of getting an audit stream of its own (DIV-10, D19).
--
-- ── "NEVER SILENTLY MIGRATES SECRETS OR ACTIVE RUNS" ──────────────────────────────────────────
--
--  SECRETS. A definition holds secret REFERENCES, never values (OWN-03), and a reference resolves
--  in its owner's scope. Moving the owner silently re-points every reference at the destination's
--  secrets -- same name, different value, no error anywhere. So the review must name each one, and
--  the destination accepts a resource whose secret surface it has been shown. Nothing here copies,
--  moves or resolves a secret; that is the point.
--
--  ACTIVE RUNS. The live grants a resource holds are its accepted and proposed assignments, and
--  §18.6 says pending work "retain[s] its original admission until safely settled or explicitly
--  converted; no mid-run implicit owner/payer switch". So acceptance is REFUSED while any live
--  assignment exists. Revoking one is an explicit act with its own record -- the "explicitly
--  converted" the rule asks for -- and refusing is strictly safer than carrying grants across an
--  ownership boundary and hoping every consumer re-checks the owner.

ALTER TABLE workforce_operations DROP CONSTRAINT workforce_operations_kind_check;
ALTER TABLE workforce_operations ADD CONSTRAINT workforce_operations_kind_check CHECK (kind IN (
  'member.admit','member.remove','member.promote',
  'division.assign','division.transfer','budget.set',
  'handoff.offer','handoff.accept','handoff.decline','handoff.expire',
  'resource.transfer'));

-- The review as a shape the database can compare. Not free text: `secretReferences` and `licenses`
-- are checked against what the resource declares, so their grammar has to be exact.
CREATE FUNCTION workforce_transfer_review_valid(value JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE field TEXT; item JSONB;
BEGIN
  IF value IS NULL OR jsonb_typeof(value) <> 'object' OR octet_length(value::text) > 65536 THEN RETURN FALSE; END IF;
  IF NOT (value ?& ARRAY['schemaVersion','secretReferences','licenses','dependencies','verdict'])
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(value) AS k
                WHERE k NOT IN ('schemaVersion','secretReferences','licenses','dependencies','verdict','notes'))
     OR value->'schemaVersion' <> '1'::jsonb
     OR jsonb_typeof(value->'verdict') <> 'string' OR value->>'verdict' NOT IN ('clear','conditions')
     OR (value ? 'notes' AND (jsonb_typeof(value->'notes') <> 'string' OR length(value->>'notes') > 8000))
     -- A conditional verdict has to say what the conditions are.
     OR (value->>'verdict' = 'conditions' AND NOT (value ? 'notes' AND length(btrim(value->>'notes')) > 0))
     THEN RETURN FALSE; END IF;
  FOREACH field IN ARRAY ARRAY['secretReferences','licenses','dependencies'] LOOP
    item := value->field;
    IF jsonb_typeof(item) <> 'array' OR jsonb_array_length(item) > 256 THEN RETURN FALSE; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(item) AS entry
               WHERE jsonb_typeof(entry) <> 'string' OR length(entry #>> '{}') NOT BETWEEN 1 AND 256) THEN RETURN FALSE; END IF;
    IF (SELECT count(*) FROM jsonb_array_elements(item)) <> (SELECT count(DISTINCT e) FROM jsonb_array_elements(item) AS e) THEN
      RETURN FALSE;
    END IF;
  END LOOP;
  RETURN TRUE;
END;
$$;

CREATE TABLE workforce_ownership_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id UUID NOT NULL,
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('agent','team')),

  -- Both endpoints as the owner XOR workforce_resources uses. The SOURCE is a snapshot, compared
  -- with the live owner on every step, so a transfer proposed against an owner who has since
  -- changed cannot complete against the new one.
  from_owner_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  from_owner_workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT,
  to_owner_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  to_owner_workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT,
  -- The resource revision the transfer was proposed against. Acceptance refuses if it moved.
  resource_revision BIGINT NOT NULL CHECK (resource_revision > 0),

  state TEXT NOT NULL DEFAULT 'proposed'
    CHECK (state IN ('proposed','authorized','reviewed','accepted','declined')),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),

  -- The acts. Attribution is nulled only by account erasure; the durable audit is the
  -- workforce_operations row, which carries no user FK and so outlives every account involved.
  proposed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  source_authorized_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  source_authorized_at TIMESTAMPTZ,
  reviewed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review JSONB CHECK (review IS NULL OR workforce_transfer_review_valid(review)),
  -- The definition version the review covered. NULL for a team, which has no definition.
  reviewed_agent_version INTEGER CHECK (reviewed_agent_version > 0),
  accepted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  declined_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  declined_at TIMESTAMPTZ,
  decline_reason TEXT CHECK (decline_reason IS NULL OR length(btrim(decline_reason)) BETWEEN 1 AND 1000),

  -- The decision record acceptance is committed under. A composite FK, so an accepted transfer
  -- that points at no decision is unrepresentable, not merely checked.
  operation_actor_user_id UUID,
  operation_client_id VARCHAR(128),
  operation_id UUID,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  FOREIGN KEY (resource_id, resource_kind) REFERENCES workforce_resources(id, kind) ON DELETE RESTRICT,
  FOREIGN KEY (operation_actor_user_id, operation_client_id, operation_id)
    REFERENCES workforce_operations(actor_user_id, client_id, operation_id) ON DELETE RESTRICT,
  CONSTRAINT workforce_transfer_source_scope CHECK (num_nonnulls(from_owner_user_id, from_owner_workspace_id) = 1),
  CONSTRAINT workforce_transfer_destination_scope CHECK (num_nonnulls(to_owner_user_id, to_owner_workspace_id) = 1),
  CONSTRAINT workforce_transfer_moves CHECK (
    from_owner_user_id IS DISTINCT FROM to_owner_user_id OR from_owner_workspace_id IS DISTINCT FROM to_owner_workspace_id),
  CONSTRAINT workforce_transfer_review_fields CHECK ((reviewed_at IS NULL) = (review IS NULL)
    AND (reviewed_agent_version IS NULL OR reviewed_at IS NOT NULL)),
  CONSTRAINT workforce_transfer_decline_fields CHECK ((declined_at IS NULL) = (decline_reason IS NULL)),
  CONSTRAINT workforce_transfer_operation_fields CHECK (num_nonnulls(operation_actor_user_id, operation_client_id, operation_id) IN (0, 3)),
  -- The state machine as a constraint, not only as trigger logic: a row missing an act is wrong
  -- on its face, whatever path wrote it.
  CONSTRAINT workforce_transfer_state_shape CHECK (
    (state = 'proposed'   AND source_authorized_at IS NULL AND reviewed_at IS NULL AND accepted_at IS NULL AND declined_at IS NULL)
 OR (state = 'authorized' AND source_authorized_at IS NOT NULL AND reviewed_at IS NULL AND accepted_at IS NULL AND declined_at IS NULL)
 OR (state = 'reviewed'   AND source_authorized_at IS NOT NULL AND reviewed_at IS NOT NULL AND accepted_at IS NULL AND declined_at IS NULL)
 OR (state = 'accepted'   AND source_authorized_at IS NOT NULL AND reviewed_at IS NOT NULL AND accepted_at IS NOT NULL
                          AND declined_at IS NULL AND operation_id IS NOT NULL)
 OR (state = 'declined'   AND declined_at IS NOT NULL AND accepted_at IS NULL)),
  CONSTRAINT workforce_transfer_order CHECK (
    (reviewed_at IS NULL OR reviewed_at >= source_authorized_at)
    AND (accepted_at IS NULL OR accepted_at >= reviewed_at))
);

-- One live transfer per resource: two simultaneous destinations is a race with an owner as the prize.
CREATE UNIQUE INDEX workforce_ownership_transfers_live
  ON workforce_ownership_transfers(resource_id) WHERE state IN ('proposed','authorized','reviewed');
CREATE INDEX workforce_ownership_transfers_resource ON workforce_ownership_transfers(resource_id, created_at DESC);
CREATE INDEX workforce_ownership_transfers_to_user
  ON workforce_ownership_transfers(to_owner_user_id, state) WHERE to_owner_user_id IS NOT NULL;
CREATE INDEX workforce_ownership_transfers_to_workspace
  ON workforce_ownership_transfers(to_owner_workspace_id, state) WHERE to_owner_workspace_id IS NOT NULL;
CREATE UNIQUE INDEX workforce_ownership_transfers_operation
  ON workforce_ownership_transfers(operation_actor_user_id, operation_client_id, operation_id) WHERE operation_id IS NOT NULL;

CREATE FUNCTION workforce_ownership_transfer_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE resource workforce_resources%ROWTYPE; op workforce_operations%ROWTYPE;
        current_version INTEGER; declared TEXT[]; reviewed TEXT[]; live_grants INTEGER; destination_status TEXT;
        erasable CONSTANT TEXT[] := ARRAY['proposed_by_user_id','source_authorized_by_user_id','reviewed_by_user_id','accepted_by_user_id','declined_by_user_id'];
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'ownership transfer history is retained; decline instead' USING ERRCODE='23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'proposed' OR NEW.revision <> 1 OR NEW.proposed_by_user_id IS NULL THEN
      RAISE EXCEPTION 'an ownership transfer must first be proposed, by someone' USING ERRCODE='23514';
    END IF;
  ELSE
    IF to_jsonb(NEW) = to_jsonb(OLD) THEN RETURN NEW; END IF;
    -- Account erasure clears attribution only, and only once the user row is gone. Nothing else moves.
    IF (to_jsonb(NEW) - erasable) = (to_jsonb(OLD) - erasable)
       AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(to_jsonb(OLD)) AS o(k, v)
         WHERE o.k = ANY(erasable) AND o.v IS NOT NULL
           AND (to_jsonb(NEW) ->> o.k) IS DISTINCT FROM o.v
           AND ((to_jsonb(NEW) ->> o.k) IS NOT NULL OR EXISTS (SELECT 1 FROM users WHERE id = o.v::uuid)))
       AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(to_jsonb(NEW)) AS n(k, v)
         WHERE n.k = ANY(erasable) AND n.v IS NOT NULL AND (to_jsonb(OLD) ->> n.k) IS NULL) THEN
      RETURN NEW;
    END IF;
    IF ROW(NEW.id,NEW.resource_id,NEW.resource_kind,NEW.from_owner_user_id,NEW.from_owner_workspace_id,
           NEW.to_owner_user_id,NEW.to_owner_workspace_id,NEW.resource_revision,NEW.proposed_by_user_id,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.resource_id,OLD.resource_kind,OLD.from_owner_user_id,OLD.from_owner_workspace_id,
           OLD.to_owner_user_id,OLD.to_owner_workspace_id,OLD.resource_revision,OLD.proposed_by_user_id,OLD.created_at) THEN
      RAISE EXCEPTION 'ownership transfer endpoints and origin are immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.state IN ('accepted','declined') OR NEW.revision <> OLD.revision + 1 OR NEW.updated_at < OLD.updated_at THEN
      RAISE EXCEPTION 'ownership transfer state or revision cannot regress' USING ERRCODE='23514';
    END IF;
    -- One step at a time, in order; declining is possible from any live step.
    IF NEW.state <> 'declined' AND NEW.state IS DISTINCT FROM (CASE OLD.state
        WHEN 'proposed' THEN 'authorized' WHEN 'authorized' THEN 'reviewed' WHEN 'reviewed' THEN 'accepted' END) THEN
      RAISE EXCEPTION 'ownership transfer steps run proposed -> authorized -> reviewed -> accepted' USING ERRCODE='23514';
    END IF;
    -- A completed act is never rewritten: who authorized, who reviewed and what they saw IS the audit.
    IF OLD.source_authorized_at IS NOT NULL AND ROW(NEW.source_authorized_at, NEW.source_authorized_by_user_id)
         IS DISTINCT FROM ROW(OLD.source_authorized_at, OLD.source_authorized_by_user_id) THEN
      RAISE EXCEPTION 'a completed source authorization cannot be rewritten' USING ERRCODE='23514';
    END IF;
    IF OLD.reviewed_at IS NOT NULL AND ROW(NEW.reviewed_at, NEW.reviewed_by_user_id, NEW.review, NEW.reviewed_agent_version)
         IS DISTINCT FROM ROW(OLD.reviewed_at, OLD.reviewed_by_user_id, OLD.review, OLD.reviewed_agent_version) THEN
      RAISE EXCEPTION 'a completed review cannot be rewritten' USING ERRCODE='23514';
    END IF;
    -- Each act is attributable when it is made.
    IF (NEW.state = 'authorized' AND NEW.source_authorized_by_user_id IS NULL)
       OR (NEW.state = 'reviewed' AND NEW.reviewed_by_user_id IS NULL)
       OR (NEW.state = 'accepted' AND NEW.accepted_by_user_id IS NULL)
       OR (NEW.state = 'declined' AND NEW.declined_by_user_id IS NULL) THEN
      RAISE EXCEPTION 'each transfer act must name who performed it' USING ERRCODE='23514';
    END IF;
  END IF;

  SELECT * INTO resource FROM workforce_resources WHERE id = NEW.resource_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ownership transfer requires a canonical resource' USING ERRCODE='23503'; END IF;
  IF NEW.state = 'declined' THEN NEW.updated_at := now(); RETURN NEW; END IF;

  -- The SOURCE is the live owner, never a claim -- checked on every step, so a transfer whose
  -- resource moved underneath it cannot continue against the new owner.
  IF resource.owner_user_id IS DISTINCT FROM NEW.from_owner_user_id
     OR resource.owner_workspace_id IS DISTINCT FROM NEW.from_owner_workspace_id THEN
    RAISE EXCEPTION 'transfer source is not the current owner' USING ERRCODE='23514';
  END IF;

  IF NEW.state IN ('reviewed','accepted') AND OLD.state IS DISTINCT FROM NEW.state THEN
    SELECT max(version) INTO current_version FROM workforce_agent_versions WHERE resource_id = NEW.resource_id;
    -- A review of a definition that has since been superseded is not a review of what is moving.
    IF NEW.reviewed_agent_version IS DISTINCT FROM current_version THEN
      RAISE EXCEPTION 'the review must cover the definition version that is moving' USING ERRCODE='23514';
    END IF;
  END IF;

  IF NEW.state = 'reviewed' AND OLD.state IS DISTINCT FROM 'reviewed' THEN
    -- 🔴 The review is compared against what the resource DECLARES -- the reason it is structured.
    -- An incomplete enumeration is what not looking produces, and it is refused here rather than
    -- filed as evidence of diligence. An over-complete one is refused too: naming a secret the
    -- resource does not have means the reviewer was looking at something else.
    SELECT coalesce(array_agg(DISTINCT ref ->> 'name' ORDER BY ref ->> 'name'), '{}') INTO declared
      FROM workforce_agent_versions v, jsonb_array_elements(coalesce(v.content -> 'secretReferences', '[]'::jsonb)) AS ref
      WHERE v.resource_id = NEW.resource_id AND v.version = current_version;
    SELECT coalesce(array_agg(DISTINCT e ORDER BY e), '{}') INTO reviewed
      FROM jsonb_array_elements_text(NEW.review -> 'secretReferences') AS e;
    IF declared IS DISTINCT FROM reviewed THEN
      RAISE EXCEPTION 'the review must enumerate exactly the secret references this resource declares' USING ERRCODE='23514';
    END IF;
    SELECT coalesce(array_agg(DISTINCT v.license ->> 'identifier' ORDER BY v.license ->> 'identifier'), '{}') INTO declared
      FROM workforce_agent_versions v
      WHERE v.resource_id = NEW.resource_id AND v.version = current_version AND v.license ? 'identifier';
    SELECT coalesce(array_agg(DISTINCT e ORDER BY e), '{}') INTO reviewed
      FROM jsonb_array_elements_text(NEW.review -> 'licenses') AS e;
    IF declared IS DISTINCT FROM reviewed THEN
      RAISE EXCEPTION 'the review must enumerate exactly the licences this resource declares' USING ERRCODE='23514';
    END IF;
  END IF;

  IF NEW.state = 'accepted' AND OLD.state IS DISTINCT FROM 'accepted' THEN
    IF resource.status <> 'active' THEN
      RAISE EXCEPTION 'an archived resource is retained where it is, not transferred' USING ERRCODE='23514';
    END IF;
    IF resource.revision <> NEW.resource_revision THEN
      RAISE EXCEPTION 'the resource changed since this transfer was proposed; repropose against what you read' USING ERRCODE='23514';
    END IF;
    IF NEW.to_owner_workspace_id IS NOT NULL THEN
      SELECT status INTO destination_status FROM workspaces WHERE id = NEW.to_owner_workspace_id FOR SHARE;
      IF destination_status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'destination workspace unavailable for acceptance' USING ERRCODE='23514';
      END IF;
    END IF;
    -- §18.6 / OWN-05: live work keeps its original admission. A grant made under the old owner
    -- does not cross an ownership boundary implicitly; it is revoked first, as its own act.
    SELECT count(*) INTO live_grants FROM workforce_workspace_assignments
      WHERE resource_id = NEW.resource_id AND state IN ('proposed','accepted');
    IF live_grants > 0 THEN
      RAISE EXCEPTION 'transfer refused: % live assignment(s) must be settled or revoked first; an owner change never migrates active work silently', live_grants
        USING ERRCODE='23514';
    END IF;
    -- The decision record must describe THIS move.
    SELECT * INTO op FROM workforce_operations
      WHERE actor_user_id = NEW.operation_actor_user_id AND client_id = NEW.operation_client_id AND operation_id = NEW.operation_id;
    IF NOT FOUND OR op.kind <> 'resource.transfer' OR op.subject_type <> 'resource' OR op.subject_id <> NEW.resource_id THEN
      RAISE EXCEPTION 'an ownership transfer commits only under a resource.transfer decision record for this resource' USING ERRCODE='23514';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER workforce_ownership_transfers_guard
BEFORE INSERT OR UPDATE OR DELETE ON workforce_ownership_transfers
FOR EACH ROW EXECUTE FUNCTION workforce_ownership_transfer_guard();
CREATE TRIGGER workforce_ownership_transfers_no_truncate
BEFORE TRUNCATE ON workforce_ownership_transfers
FOR EACH STATEMENT EXECUTE FUNCTION workforce_ownership_transfer_guard();

-- Acceptance MOVES the owner, in the same transaction, advancing the revision the 20260923120000
-- guard requires. Done here rather than left to callers so that "accepted" and "moved" cannot come
-- apart: an accepted transfer whose resource never moved would be the worst of both records.
CREATE FUNCTION workforce_ownership_transfer_commit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'accepted' AND OLD.state IS DISTINCT FROM 'accepted' THEN
    UPDATE workforce_resources
       SET owner_user_id = NEW.to_owner_user_id, owner_workspace_id = NEW.to_owner_workspace_id,
           revision = revision + 1, updated_at = now()
     WHERE id = NEW.resource_id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER workforce_ownership_transfers_commit
AFTER UPDATE ON workforce_ownership_transfers
FOR EACH ROW EXECUTE FUNCTION workforce_ownership_transfer_commit();

DO $harden$
DECLARE fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY['workforce_transfer_review_valid(jsonb)','workforce_ownership_transfer_guard()','workforce_ownership_transfer_commit()'] LOOP
    EXECUTE format('ALTER FUNCTION %I.%s SET search_path = %I, pg_temp', current_schema(), fn, current_schema());
  END LOOP;
END $harden$;

-- DOWN
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM workforce_ownership_transfers) OR EXISTS(SELECT 1 FROM workforce_operations WHERE kind = 'resource.transfer') THEN
    RAISE EXCEPTION 'ownership transfer rollback refused: retained records exist' USING ERRCODE='23514';
  END IF;
END $$;
DROP TRIGGER workforce_ownership_transfers_commit ON workforce_ownership_transfers;
DROP FUNCTION workforce_ownership_transfer_commit();
DROP TRIGGER workforce_ownership_transfers_no_truncate ON workforce_ownership_transfers;
DROP TRIGGER workforce_ownership_transfers_guard ON workforce_ownership_transfers;
DROP FUNCTION workforce_ownership_transfer_guard();
DROP TABLE workforce_ownership_transfers;
DROP FUNCTION workforce_transfer_review_valid(JSONB);
ALTER TABLE workforce_operations DROP CONSTRAINT workforce_operations_kind_check;
ALTER TABLE workforce_operations ADD CONSTRAINT workforce_operations_kind_check CHECK (kind IN (
  'member.admit','member.remove','member.promote',
  'division.assign','division.transfer','budget.set',
  'handoff.offer','handoff.accept','handoff.decline','handoff.expire'));
