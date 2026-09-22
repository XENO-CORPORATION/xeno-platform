-- UP
-- XENO-WORKFORCE-01 §8.2c work handoff (HAND-01..HAND-06) and §8.2d LIFE-06/LIFE-07, under
-- decision D19.
--
-- D19 IS WHY THERE IS NO `workforce_decisions` TABLE. A decision record is a TYPED PROJECTION of
-- the durable-operation record, not a second write path: §12.1's last rule forbids "two
-- independently writable authorities", and a separate decision table would drift the first time an
-- operation committed while its decision row failed. So the deliberative fields LIFE-06 requires
-- live ON the operation, and `workforce_decision_records` below is a VIEW. The decision and its
-- effect commit together or not at all.
--
-- The existing `workforce_resource_operations` is creation-specific (`UNIQUE (resource_id)`), so
-- it cannot carry admit/remove/promote/handoff. This adds the general operation table those need
-- and keeps the same discipline: metadata only, immutable once written, actor UUIDs as tombstones
-- rather than cascading FKs, because erasure must not forget a duplicate fence.

CREATE TABLE workforce_operations (
  -- §12.1: unique per logical request, idempotent on retry. Same identity shape as the creation
  -- receipts, so a retry of any operation reuses its row rather than repeating the effect.
  actor_user_id UUID NOT NULL,
  client_id VARCHAR(128) NOT NULL CHECK (client_id ~ '^[a-zA-Z0-9._-]{1,128}$'),
  operation_id UUID NOT NULL,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),

  -- The acts LIFE-06 names. `handoff.*` is here too: a handoff is a durable operation (HAND-01),
  -- not a message, so it shares the identity and idempotency rules rather than inventing its own.
  kind TEXT NOT NULL CHECK (kind IN (
    'member.admit','member.remove','member.promote',
    'division.assign','division.transfer','budget.set',
    'handoff.offer','handoff.accept','handoff.decline','handoff.expire')),

  -- What the act was about. Deliberately a loose (type,id) pair rather than an FK per kind: an
  -- operation must outlive the row it acted on, or the audit trail disappears exactly when the
  -- thing is removed -- which is the case an audit exists for.
  subject_type TEXT NOT NULL CHECK (subject_type IN ('resource','membership','division','handoff','budget')),
  subject_id UUID NOT NULL,

  -- LIFE-07: BOTH principals, always. An agent may hold the decision and its owner still answers
  -- for it -- "an agent decided" is not an accountability answer. `responsible_account_id` is the
  -- human whose authority the decision was taken under; for a human decider they are the same id,
  -- which is a fact worth storing rather than inferring.
  deciding_principal_id UUID NOT NULL,
  responsible_account_id UUID NOT NULL,

  -- LIFE-06's deliberative layer: WHY, not just what. §15 already records state changes and
  -- authorization reasons; that is the operational log. These are the fields an operator, an
  -- auditor or a successor agent needs to understand the reasoning.
  authority TEXT NOT NULL CHECK (length(btrim(authority)) > 0),
  rationale TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
  supersedes_operation_id UUID,

  -- The scopes this act crossed (HAND-04, and useful on every kind). Recorded as the ids
  -- themselves so a later reader does not have to reconstruct them from rows that may be gone.
  workspace_id UUID,
  division_id UUID,

  committed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_user_id, client_id, operation_id)
);

CREATE INDEX workforce_operations_subject ON workforce_operations(subject_type, subject_id, committed_at);
CREATE INDEX workforce_operations_workspace ON workforce_operations(workspace_id, committed_at)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX workforce_operations_principal ON workforce_operations(deciding_principal_id, committed_at);

CREATE FUNCTION workforce_operation_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'workforce operations are immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER workforce_operations_immutable
  BEFORE UPDATE OR DELETE ON workforce_operations
  FOR EACH ROW EXECUTE FUNCTION workforce_operation_immutable();
CREATE TRIGGER workforce_operations_no_truncate
  BEFORE TRUNCATE ON workforce_operations
  FOR EACH STATEMENT EXECUTE FUNCTION workforce_operation_immutable();

-- ── LIFE-06: the decision record, as a PROJECTION (D19) ──────────────────────────────────────
-- A VIEW, not a table. There is exactly one write path, so a decision cannot exist without its
-- effect and an effect cannot exist without its decision.
CREATE VIEW workforce_decision_records AS
SELECT operation_id, kind AS decided, subject_type, subject_id,
       deciding_principal_id, responsible_account_id,
       authority, rationale, evidence, supersedes_operation_id,
       workspace_id, division_id, committed_at
FROM workforce_operations;

-- ── HAND-01..HAND-06: the handoff ────────────────────────────────────────────────────────────
CREATE TABLE workforce_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- HAND-01: source and target are each a PRINCIPAL **plus the membership they act under**. The
  -- membership is what makes RUN-02's intersection computable at all -- a principal alone does not
  -- say which team's scope it was acting in.
  source_principal_id UUID NOT NULL,
  source_membership_id UUID,
  target_principal_id UUID NOT NULL,
  target_membership_id UUID,

  work_ref_type TEXT NOT NULL CHECK (work_ref_type IN ('task','project','run')),
  work_ref_id UUID NOT NULL,
  artifact_ref TEXT,

  -- HAND-04: every trust boundary crossed is recorded. Stored as the from/to ids rather than a
  -- boolean, because "it crossed a workspace" is not answerable later from a flag.
  source_workspace_id UUID,
  target_workspace_id UUID,
  source_division_id UUID REFERENCES workforce_divisions(id) ON DELETE RESTRICT,
  target_division_id UUID REFERENCES workforce_divisions(id) ON DELETE RESTRICT,

  -- HAND-03: `offered` until accepted; an unaccepted handoff EXPIRES WITHOUT EXECUTING.
  state TEXT NOT NULL DEFAULT 'offered' CHECK (state IN ('offered','accepted','declined','expired')),
  expires_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,

  -- HAND-05: billable and attributable to the EXECUTING side. Defaulting this to the source is
  -- the whole defect the requirement exists to prevent, so it is NOT defaulted -- it is set when
  -- the target accepts, and is NULL while merely offered.
  payer_account_id UUID,

  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- HAND-02, said by the schema: there is NO column carrying a grant, a capability or a scope from
  -- source to target. The receiving principal executes under its OWN admitted rights. A handoff
  -- that widened the receiver's scope would be the runtime inventing an entitlement.
  CONSTRAINT workforce_handoff_not_self CHECK (source_principal_id <> target_principal_id),
  -- An accepted handoff has a payer and a time; an unresolved one has neither.
  CONSTRAINT workforce_handoff_accepted_shape CHECK (
    (state = 'accepted' AND accepted_at IS NOT NULL AND payer_account_id IS NOT NULL)
    OR (state <> 'accepted' AND accepted_at IS NULL AND payer_account_id IS NULL)),
  CONSTRAINT workforce_handoff_resolved_shape CHECK (
    (state IN ('declined','expired')) = (resolved_at IS NOT NULL))
);

CREATE INDEX workforce_handoff_target ON workforce_handoffs(target_principal_id, state, created_at);
CREATE INDEX workforce_handoff_work ON workforce_handoffs(work_ref_type, work_ref_id);
CREATE INDEX workforce_handoff_pending ON workforce_handoffs(expires_at) WHERE state = 'offered';

CREATE FUNCTION workforce_handoff_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- The endpoints and the work are what the offer WAS. Letting them move would make an accepted
    -- handoff a different handoff than the one the target agreed to.
    IF ROW(NEW.source_principal_id, NEW.target_principal_id, NEW.work_ref_type, NEW.work_ref_id,
           NEW.source_workspace_id, NEW.target_workspace_id, NEW.source_division_id, NEW.target_division_id)
       IS DISTINCT FROM
       ROW(OLD.source_principal_id, OLD.target_principal_id, OLD.work_ref_type, OLD.work_ref_id,
           OLD.source_workspace_id, OLD.target_workspace_id, OLD.source_division_id, OLD.target_division_id) THEN
      RAISE EXCEPTION 'handoff endpoints, work and crossed scopes are immutable' USING ERRCODE='23514';
    END IF;

    -- HAND-03: `offered` is the only state with anywhere to go. A terminal state is terminal --
    -- re-opening a declined or expired handoff would execute work nobody currently agreed to.
    IF OLD.state <> 'offered' THEN
      RAISE EXCEPTION 'a resolved handoff cannot change state' USING ERRCODE='23514';
    END IF;

    IF NEW.revision <> OLD.revision + 1 THEN
      RAISE EXCEPTION 'handoff revision must advance by exactly one' USING ERRCODE='23514';
    END IF;

    -- HAND-05: the payer is the EXECUTING side. Recorded as a constraint rather than a convention
    -- because "bill the sender" is the natural-looking mistake, and without this the receipt chain
    -- would attribute an agent's consumption to whoever handed it the work.
    IF NEW.state = 'accepted' AND NEW.payer_account_id = OLD.source_principal_id THEN
      RAISE EXCEPTION 'handoff consumption is attributed to the executing side, never the sender'
        USING ERRCODE='23514';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_handoff_guard_trigger
  BEFORE INSERT OR UPDATE ON workforce_handoffs
  FOR EACH ROW EXECUTE FUNCTION workforce_handoff_guard();

-- DOWN
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM workforce_operations) OR EXISTS(SELECT 1 FROM workforce_handoffs) THEN
    RAISE EXCEPTION 'workforce handoff/operation rollback refused: retained records exist'
      USING ERRCODE='23514';
  END IF;
END $$;
DROP TRIGGER workforce_handoff_guard_trigger ON workforce_handoffs;
DROP FUNCTION workforce_handoff_guard();
DROP TABLE workforce_handoffs;
DROP VIEW workforce_decision_records;
DROP TRIGGER workforce_operations_no_truncate ON workforce_operations;
DROP TRIGGER workforce_operations_immutable ON workforce_operations;
DROP FUNCTION workforce_operation_immutable();
DROP TABLE workforce_operations;
