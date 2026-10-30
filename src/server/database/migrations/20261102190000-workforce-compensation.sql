-- XENO workforce compensation (owner, 2026-10-29: "Agreements + credits, a person approves").
--
-- An AGREEMENT says how a member of a workspace is paid; a PAYOUT is one period's payment under it, PREPARED
-- from the agreement and the member's work report (services/workforceEvaluation.js) and DECIDED by a person.
-- Spec D13 holds: nothing pays implicitly -- a payout moves money only when a human administrator approves it,
-- and the amount is never set by the counts alone (EU GDPR Art. 22, AI Act Annex III 4(b)).
--
--   basis per_period         amount_micro credits each period
--         per_accepted_task  amount_micro credits for each task of theirs a PERSON accepted from review
--         revenue_share      share_bps of revenue the member earned the workspace (none is recorded yet)
--         salary_recorded    a salary paid OUTSIDE XENO, recorded for export to a payroll provider
--
-- Credits move from the WORKSPACE wallet to the payee over the existing ledger (recordUsageV2 debit + a paid
-- grant, the reverse of walletService.transferToWorkspace), keyed `ws-comp:<payout id>` so a retry pays once.
-- An agent's payout goes to its owner: an agent account holds no money of its own here.
--
-- Additive. Both tables are retained: no row is deleted, decided payouts do not change.
-- UP
CREATE TABLE workforce_comp_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  principal_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  basis text NOT NULL CHECK (basis IN ('per_period', 'per_accepted_task', 'revenue_share', 'salary_recorded')),
  amount_micro bigint CHECK (amount_micro IS NULL OR amount_micro > 0),
  share_bps integer CHECK (share_bps IS NULL OR share_bps BETWEEN 1 AND 10000),
  salary_minor bigint CHECK (salary_minor IS NULL OR salary_minor > 0),
  salary_currency text CHECK (salary_currency IS NULL OR salary_currency ~ '^[A-Z]{3}$'),
  period text NOT NULL DEFAULT 'month' CHECK (period IN ('week', 'month')),
  starts_on date NOT NULL,
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'ended')),
  ended_on date,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  ended_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((basis IN ('per_period', 'per_accepted_task')) = (amount_micro IS NOT NULL)),
  CHECK ((basis = 'revenue_share') = (share_bps IS NOT NULL)),
  CHECK ((basis = 'salary_recorded') = (salary_minor IS NOT NULL AND salary_currency IS NOT NULL)),
  CHECK ((state = 'ended') = (ended_on IS NOT NULL AND ended_by_user_id IS NOT NULL))
);
-- one active agreement per member: a new one ENDS the old one first
CREATE UNIQUE INDEX workforce_comp_agreements_active ON workforce_comp_agreements(workspace_id, principal_id) WHERE state = 'active';
CREATE INDEX workforce_comp_agreements_ws ON workforce_comp_agreements(workspace_id, created_at DESC);

CREATE TABLE workforce_comp_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  agreement_id uuid NOT NULL REFERENCES workforce_comp_agreements(id) ON DELETE RESTRICT,
  principal_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  payee_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  period_end date NOT NULL CHECK (period_end > period_start),
  -- what it was prepared from: the counts and the ids of the records behind them
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  prepared_micro bigint NOT NULL CHECK (prepared_micro >= 0),
  amount_micro bigint NOT NULL CHECK (amount_micro >= 0),
  state text NOT NULL DEFAULT 'prepared' CHECK (state IN ('prepared', 'approved', 'paid', 'skipped')),
  prepared_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decided_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  decided_at timestamptz,
  decision_note text NOT NULL DEFAULT '' CHECK (length(decision_note) <= 500),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agreement_id, period_start, period_end),
  CHECK ((state = 'prepared') = (decided_by_user_id IS NULL)),
  CHECK ((state = 'paid') = (paid_at IS NOT NULL))
);
CREATE INDEX workforce_comp_payouts_ws ON workforce_comp_payouts(workspace_id, period_start DESC);
CREATE INDEX workforce_comp_payouts_principal ON workforce_comp_payouts(principal_id, period_start DESC);

-- Agreements: only an active one may end; nothing else changes and nothing is deleted.
CREATE FUNCTION workforce_comp_agreement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'compensation agreements are retained' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM agent_identities WHERE user_id = NEW.created_by_user_id) THEN
      RAISE EXCEPTION 'a compensation agreement is set by a person, never an agent' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state <> 'active' OR NEW.state <> 'ended'
     OR (to_jsonb(NEW) - 'state' - 'ended_on' - 'ended_by_user_id') <> (to_jsonb(OLD) - 'state' - 'ended_on' - 'ended_by_user_id') THEN
    RAISE EXCEPTION 'a compensation agreement only ends; a new one replaces it' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM agent_identities WHERE user_id = NEW.ended_by_user_id) THEN
    RAISE EXCEPTION 'a compensation agreement is ended by a person, never an agent' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workforce_comp_agreement_guard BEFORE INSERT OR UPDATE OR DELETE ON workforce_comp_agreements
  FOR EACH ROW EXECUTE FUNCTION workforce_comp_agreement_guard();

-- Payouts: prepared -> approved | skipped, approved -> paid. Only a PERSON decides; the amount may be edited
-- only while prepared; a decided payout is fixed; nothing is deleted.
CREATE FUNCTION workforce_comp_payout_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'payouts are retained' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'prepared' THEN RAISE EXCEPTION 'a payout is created prepared' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'state' - 'amount_micro' - 'decided_by_user_id' - 'decided_at' - 'decision_note' - 'paid_at')
     <> (to_jsonb(OLD) - 'state' - 'amount_micro' - 'decided_by_user_id' - 'decided_at' - 'decision_note' - 'paid_at') THEN
    RAISE EXCEPTION 'a payout keeps what it was prepared from' USING ERRCODE = '23514';
  END IF;
  IF OLD.state = 'prepared' AND NEW.state = 'prepared' THEN RETURN NEW; END IF;  -- an edit before deciding
  IF NOT ((OLD.state = 'prepared' AND NEW.state IN ('approved', 'skipped')) OR (OLD.state = 'approved' AND NEW.state = 'paid')) THEN
    RAISE EXCEPTION 'payout cannot move from % to %', OLD.state, NEW.state USING ERRCODE = '23514';
  END IF;
  IF OLD.state = 'approved' AND (NEW.amount_micro <> OLD.amount_micro OR NEW.decided_by_user_id <> OLD.decided_by_user_id) THEN
    RAISE EXCEPTION 'an approved payout is fixed' USING ERRCODE = '23514';
  END IF;
  IF NEW.decided_by_user_id IS NULL OR EXISTS (SELECT 1 FROM agent_identities WHERE user_id = NEW.decided_by_user_id) THEN
    RAISE EXCEPTION 'a payout is decided by a person, never an agent' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workforce_comp_payout_guard BEFORE INSERT OR UPDATE OR DELETE ON workforce_comp_payouts
  FOR EACH ROW EXECUTE FUNCTION workforce_comp_payout_guard();

-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM workforce_comp_payouts) OR EXISTS (SELECT 1 FROM workforce_comp_agreements) THEN
    RAISE EXCEPTION 'compensation rollback refused: agreements or payouts exist' USING ERRCODE = '23514';
  END IF;
END $$;
DROP TABLE IF EXISTS workforce_comp_payouts;
DROP TABLE IF EXISTS workforce_comp_agreements;
DROP FUNCTION IF EXISTS workforce_comp_payout_guard();
DROP FUNCTION IF EXISTS workforce_comp_agreement_guard();
