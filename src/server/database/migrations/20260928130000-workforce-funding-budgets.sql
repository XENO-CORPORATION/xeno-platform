-- UP
-- A proposal is not spending authority. Approval is an independent, bounded decision;
-- execution must still reserve eligible lots and meet the milestone threshold.
CREATE TABLE workforce_funding_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id uuid NOT NULL REFERENCES workforce_funding_pools(id) ON DELETE RESTRICT,
  proposed_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  spender_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_id text NOT NULL CHECK(client_id ~ '^[A-Za-z0-9._-]{1,128}$'),
  operation_id uuid NOT NULL,
  request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  terms_hash text NOT NULL CHECK(terms_hash ~ '^[a-f0-9]{64}$'),
  maximum_micro bigint NOT NULL CHECK(maximum_micro>0),
  per_run_micro bigint NOT NULL CHECK(per_run_micro>0 AND per_run_micro<=maximum_micro),
  purpose text NOT NULL CHECK(length(btrim(purpose)) BETWEEN 1 AND 2000),
  price_version text NOT NULL CHECK(length(btrim(price_version)) BETWEEN 1 AND 128),
  state text NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed','approved','rejected','revoked')),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  decided_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  decision_operation_id uuid,
  decided_at timestamptz,
  revoked_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(proposed_by_user_id,client_id,operation_id),
  CHECK ((decided_by_user_id IS NULL)=(decided_at IS NULL)),
  CHECK ((decided_by_user_id IS NULL)=(decision_operation_id IS NULL)),
  CHECK (decided_by_user_id IS NULL OR decided_by_user_id<>proposed_by_user_id),
  CHECK (decided_by_user_id IS NULL OR decided_by_user_id<>spender_user_id),
  CHECK ((revoked_by_user_id IS NULL)=(revoked_at IS NULL))
);
-- At most one active approval per pool. Multiple full-ceiling approvals must never
-- multiply a milestone's authorized maximum. Historical approvals are retained.
CREATE UNIQUE INDEX workforce_funding_budget_active ON workforce_funding_budgets(pool_id) WHERE state='approved';
CREATE INDEX workforce_funding_budget_pool ON workforce_funding_budgets(pool_id,created_at,id);
CREATE FUNCTION workforce_funding_budget_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cap bigint;
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'funding budget decisions are retained' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'proposed' OR NEW.revision<>1 OR NEW.decided_by_user_id IS NOT NULL OR NEW.revoked_by_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'budget begins as an undecided proposal' USING ERRCODE='23514';
    END IF;
    SELECT m.budget_max_micro INTO cap FROM workforce_funding_pools p
      JOIN workforce_funding_milestones m ON m.id=p.milestone_id WHERE p.id=NEW.pool_id;
    IF cap IS NULL OR NEW.maximum_micro>cap THEN
      RAISE EXCEPTION 'budget exceeds contributor-authorized milestone maximum' USING ERRCODE='23514';
    END IF;
  ELSE
    IF (to_jsonb(NEW)-'state'-'revision'-'decided_by_user_id'-'decision_operation_id'-'decided_at'-'revoked_by_user_id'-'revoked_at')
      IS DISTINCT FROM (to_jsonb(OLD)-'state'-'revision'-'decided_by_user_id'-'decision_operation_id'-'decided_at'-'revoked_by_user_id'-'revoked_at') THEN
      RAISE EXCEPTION 'budget purpose, limits and price are immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.revision<>OLD.revision+1 OR NOT (
      (OLD.state='proposed' AND NEW.state IN ('approved','rejected') AND NEW.decided_by_user_id IS NOT NULL AND NEW.revoked_by_user_id IS NULL)
      OR (OLD.state='approved' AND NEW.state='revoked' AND NEW.revoked_by_user_id IS NOT NULL
          AND ROW(NEW.decided_by_user_id,NEW.decision_operation_id,NEW.decided_at) IS NOT DISTINCT FROM
              ROW(OLD.decided_by_user_id,OLD.decision_operation_id,OLD.decided_at))) THEN
      RAISE EXCEPTION 'invalid funding budget decision transition' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workforce_funding_budget_guard BEFORE INSERT OR UPDATE OR DELETE ON workforce_funding_budgets
 FOR EACH ROW EXECUTE FUNCTION workforce_funding_budget_guard();
CREATE TRIGGER workforce_funding_budget_retained BEFORE TRUNCATE ON workforce_funding_budgets
 FOR EACH STATEMENT EXECUTE FUNCTION workforce_funding_budget_guard();
DO $harden$ BEGIN
 EXECUTE format('ALTER FUNCTION %I.workforce_funding_budget_guard() SET search_path = %I, pg_temp',current_schema(),current_schema());
END $harden$;

-- DOWN
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM workforce_funding_budgets) THEN
   RAISE EXCEPTION 'budget rollback refused: retained decisions exist' USING ERRCODE='23514';
 END IF;
END $$;
DROP TABLE workforce_funding_budgets;
DROP FUNCTION workforce_funding_budget_guard();
