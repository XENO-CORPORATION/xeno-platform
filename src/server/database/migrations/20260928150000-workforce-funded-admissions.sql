-- UP
-- One selected payer, one canonical hold per root. Children carve the existing
-- root envelope; they never manufacture a second allocation of the same lots.
ALTER TABLE workforce_run_admissions DROP CONSTRAINT workforce_run_admissions_payer_kind_check;
ALTER TABLE workforce_run_admissions ADD CONSTRAINT workforce_run_admissions_payer_kind_check
  CHECK(payer_kind IN ('user','project_pool'));
ALTER TABLE workforce_run_admissions ADD COLUMN funding_budget_id uuid REFERENCES workforce_funding_budgets(id) ON DELETE RESTRICT;
ALTER TABLE workforce_run_admissions ADD CONSTRAINT workforce_run_funding_shape CHECK (
  (payer_kind='user' AND funding_budget_id IS NULL)
  OR (payer_kind='project_pool' AND funding_budget_id IS NOT NULL AND target_kind='project')
);
CREATE TABLE workforce_run_funding (
  admission_id uuid PRIMARY KEY REFERENCES workforce_run_admissions(id) ON DELETE RESTRICT,
  root_admission_id uuid NOT NULL REFERENCES workforce_run_admissions(id) ON DELETE RESTRICT,
  budget_id uuid NOT NULL REFERENCES workforce_funding_budgets(id) ON DELETE RESTRICT,
  pool_id uuid NOT NULL REFERENCES workforce_funding_pools(id) ON DELETE RESTRICT,
  hold_row_id uuid NOT NULL,
  reserved_micro bigint NOT NULL CHECK(reserved_micro>0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workforce_run_funding_pool ON workforce_run_funding(pool_id,root_admission_id);
CREATE UNIQUE INDEX workforce_run_funding_root_hold ON workforce_run_funding(hold_row_id) WHERE admission_id=root_admission_id;
CREATE FUNCTION workforce_run_funding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a workforce_run_admissions%ROWTYPE; b workforce_funding_budgets%ROWTYPE; p workforce_funding_pools%ROWTYPE; h record; parent workforce_run_funding%ROWTYPE;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'run funding is retained and immutable' USING ERRCODE='23514'; END IF;
  SELECT * INTO a FROM workforce_run_admissions WHERE id=NEW.admission_id;
  SELECT * INTO b FROM workforce_funding_budgets WHERE id=NEW.budget_id;
  SELECT * INTO p FROM workforce_funding_pools WHERE id=NEW.pool_id;
  IF a.payer_kind IS DISTINCT FROM 'project_pool' OR a.funding_budget_id IS DISTINCT FROM b.id OR b.pool_id IS DISTINCT FROM p.id OR a.payer_user_id IS DISTINCT FROM p.account_owner_id
    OR NOT EXISTS(SELECT 1 FROM workforce_funding_campaigns c WHERE c.id=p.campaign_id AND c.project_id=a.project_id)
    OR NEW.reserved_micro<>a.budget_ceiling_micro OR b.state<>'approved' OR b.spender_user_id<>a.actor_user_id
    OR b.price_snapshot IS NULL OR NEW.reserved_micro>b.per_run_micro THEN
    RAISE EXCEPTION 'run funding does not match admitted budget authority' USING ERRCODE='23514';
  END IF;
  IF a.parent_admission_id IS NULL THEN
    IF NEW.root_admission_id<>a.id THEN RAISE EXCEPTION 'root funding must name itself' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT * INTO parent FROM workforce_run_funding WHERE admission_id=a.parent_admission_id;
    IF NOT FOUND OR parent.budget_id<>NEW.budget_id OR parent.pool_id<>NEW.pool_id OR parent.hold_row_id<>NEW.hold_row_id OR parent.root_admission_id<>NEW.root_admission_id THEN
      RAISE EXCEPTION 'child funding must carve the same root hold' USING ERRCODE='23514';
    END IF;
  END IF;
  SELECT * INTO h FROM credit_holds WHERE id=NEW.hold_row_id;
  IF NOT FOUND OR h.user_id<>p.account_owner_id OR h.account_id<>p.account_id OR h.state<>'held'
    OR (a.parent_admission_id IS NULL AND h.amount_micro<>NEW.reserved_micro) THEN
    RAISE EXCEPTION 'funded admission requires its canonical hold' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workforce_run_funding_guard BEFORE INSERT OR UPDATE OR DELETE ON workforce_run_funding
  FOR EACH ROW EXECUTE FUNCTION workforce_run_funding_guard();
CREATE TRIGGER workforce_run_funding_retained BEFORE TRUNCATE ON workforce_run_funding
  FOR EACH STATEMENT EXECUTE FUNCTION workforce_run_admission_immutable();
CREATE FUNCTION workforce_run_funding_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payer_kind='project_pool' AND NOT EXISTS(SELECT 1 FROM workforce_run_funding WHERE admission_id=NEW.id) THEN
    RAISE EXCEPTION 'pool admission and reservation must commit together' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER workforce_run_funding_required AFTER INSERT ON workforce_run_admissions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workforce_run_funding_required();
DO $harden$ BEGIN
  EXECUTE format('ALTER FUNCTION %I.workforce_run_funding_guard() SET search_path = %I, pg_temp',current_schema(),current_schema());
  EXECUTE format('ALTER FUNCTION %I.workforce_run_funding_required() SET search_path = %I, pg_temp',current_schema(),current_schema());
END $harden$;

-- DOWN
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM workforce_run_admissions WHERE payer_kind='project_pool') THEN
  RAISE EXCEPTION 'funded admission rollback refused: retained admissions exist' USING ERRCODE='23514';
 END IF;
END $$;
DROP TRIGGER workforce_run_funding_required ON workforce_run_admissions;
DROP FUNCTION workforce_run_funding_required();
DROP TABLE workforce_run_funding;
DROP FUNCTION workforce_run_funding_guard();
ALTER TABLE workforce_run_admissions DROP CONSTRAINT workforce_run_funding_shape;
ALTER TABLE workforce_run_admissions DROP COLUMN funding_budget_id;
ALTER TABLE workforce_run_admissions DROP CONSTRAINT workforce_run_admissions_payer_kind_check;
ALTER TABLE workforce_run_admissions ADD CONSTRAINT workforce_run_admissions_payer_kind_check CHECK(payer_kind='user');
