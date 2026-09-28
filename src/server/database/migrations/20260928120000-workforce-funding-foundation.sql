-- XENO-WORKFORCE-01 FUND-01..FUND-05/FUND-13/FUND-17/FUND-18 foundation.
-- Project funding is a restricted allocation on the canonical credit ledger. These are
-- records around ledger accounts, not a second balance or currency.

CREATE TABLE workforce_funding_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE RESTRICT,
  -- Historical creator attribution; project ReBAC is the authority for management.
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_id TEXT NOT NULL,
  operation_id UUID NOT NULL,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  UNIQUE(owner_user_id,client_id,operation_id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','paused','closed','cancelled','reconciling')),
  terms_version INTEGER NOT NULL DEFAULT 1 CHECK (terms_version > 0),
  beneficiary TEXT NOT NULL CHECK (length(btrim(beneficiary)) BETWEEN 1 AND 500),
  cancellation_terms TEXT NOT NULL CHECK (length(cancellation_terms) BETWEEN 1 AND 10000),
  refund_terms TEXT NOT NULL CHECK (length(refund_terms) BETWEEN 1 AND 10000),
  deliverable_license TEXT NOT NULL CHECK (length(btrim(deliverable_license)) BETWEEN 1 AND 120),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX workforce_funding_campaigns_project ON workforce_funding_campaigns(project_id);

CREATE TABLE workforce_funding_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES workforce_funding_campaigns(id) ON DELETE RESTRICT,
  milestone_key TEXT NOT NULL CHECK (milestone_key ~ '^[a-z][a-z0-9._-]{0,63}$'),
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  acceptance_criteria JSONB NOT NULL CHECK (jsonb_typeof(acceptance_criteria) = 'object'),
  threshold_micro BIGINT NOT NULL CHECK (threshold_micro > 0),
  budget_max_micro BIGINT NOT NULL CHECK (budget_max_micro >= threshold_micro),
  terms_version INTEGER NOT NULL CHECK (terms_version > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','funded','active','accepted','cancelled')),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, milestone_key),
  UNIQUE(id,campaign_id)
);
CREATE INDEX workforce_funding_milestones_campaign ON workforce_funding_milestones(campaign_id);

CREATE TABLE workforce_funding_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES workforce_funding_campaigns(id) ON DELETE RESTRICT,
  milestone_id UUID REFERENCES workforce_funding_milestones(id) ON DELETE RESTRICT,
  account_id UUID NOT NULL UNIQUE REFERENCES credit_accounts(id) ON DELETE RESTRICT,
  account_owner_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (account_owner_id = id),
  FOREIGN KEY(milestone_id,campaign_id) REFERENCES workforce_funding_milestones(id,campaign_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX workforce_funding_pool_campaign_milestone
  ON workforce_funding_pools(campaign_id, COALESCE(milestone_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE workforce_funding_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES workforce_funding_campaigns(id) ON DELETE RESTRICT,
  milestone_id UUID NOT NULL REFERENCES workforce_funding_milestones(id) ON DELETE RESTRICT,
  contributor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_id TEXT NOT NULL CHECK (client_id ~ '^[A-Za-z0-9._-]{1,128}$'),
  idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  operation_id UUID NOT NULL,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  amount_micro BIGINT NOT NULL CHECK (amount_micro > 0),
  terms_version INTEGER NOT NULL CHECK (terms_version > 0),
  restriction JSONB NOT NULL CHECK (jsonb_typeof(restriction) = 'object'),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','confirmed','return_pending','returned','disputed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(contributor_user_id, client_id, idempotency_key),
  UNIQUE(contributor_user_id, client_id, operation_id),
  FOREIGN KEY(milestone_id,campaign_id) REFERENCES workforce_funding_milestones(id,campaign_id) ON DELETE RESTRICT
);
CREATE INDEX workforce_funding_contributions_campaign ON workforce_funding_contributions(campaign_id, milestone_id, state);

CREATE TABLE workforce_contribution_lots (
  contribution_id UUID NOT NULL REFERENCES workforce_funding_contributions(id) ON DELETE RESTRICT,
  -- credit_grants is created by account-v2 after the versioned chain. A deferred
  -- integrity trigger below checks its rows when contributions are written.
  origin_grant_id UUID NOT NULL,
  pool_grant_id UUID NOT NULL,
  amount_micro BIGINT NOT NULL CHECK (amount_micro > 0),
  origin_kind TEXT NOT NULL CHECK (origin_kind = 'paid'),
  origin_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(contribution_id, origin_grant_id),
  UNIQUE(pool_grant_id)
);

-- A refunded/disputed origin is quarantined by identity, never by debiting unrelated
-- contributors or the project manager. The unresolved liability remains explicit;
-- this record does NOT pretend the loss has been covered by a funded reserve.
CREATE TABLE workforce_funding_origin_quarantine (
  event_id TEXT PRIMARY KEY,
  payment_intent TEXT NOT NULL,
  grant_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN ('refund','dispute')),
  liability_micro BIGINT NOT NULL CHECK(liability_micro >= 0),
  state TEXT NOT NULL DEFAULT 'reconciliation_required' CHECK(state='reconciliation_required'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX workforce_funding_quarantined_origin ON workforce_funding_origin_quarantine(grant_id);

CREATE TABLE workforce_funding_returns (
  contribution_id UUID PRIMARY KEY REFERENCES workforce_funding_contributions(id) ON DELETE RESTRICT,
  returned_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_micro BIGINT NOT NULL CHECK (amount_micro >= 0),
  expired_micro BIGINT NOT NULL CHECK (expired_micro BETWEEN 0 AND amount_micro),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE workforce_funding_return_lots (
  contribution_id UUID NOT NULL REFERENCES workforce_funding_returns(contribution_id) ON DELETE RESTRICT,
  pool_grant_id UUID NOT NULL,
  origin_grant_id UUID NOT NULL,
  amount_micro BIGINT NOT NULL CHECK(amount_micro > 0),
  PRIMARY KEY(contribution_id,pool_grant_id)
);

-- Spend/approval delegation is not manufactured by contribution creation. That
-- follow-on uses the existing principal/ReBAC authority and a bounded approval record.

CREATE FUNCTION workforce_funding_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  IF (to_jsonb(OLD)-'state'-'updated_at') IS DISTINCT FROM (to_jsonb(NEW)-'state'-'updated_at') THEN
    RAISE EXCEPTION 'funding contribution terms are immutable; return and create a new contribution' USING ERRCODE='23514';
  END IF;
  IF OLD.state <> NEW.state AND NOT (OLD.state='pending' AND NEW.state='confirmed')
     AND NOT (OLD.state='confirmed' AND NEW.state IN ('return_pending','disputed'))
     AND NOT (OLD.state='return_pending' AND NEW.state='returned') THEN
    RAISE EXCEPTION 'invalid contribution state transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER workforce_funding_contributions_guard BEFORE UPDATE ON workforce_funding_contributions
FOR EACH ROW EXECUTE FUNCTION workforce_funding_immutable();

-- Pools are typed ledger accounts. The account row must already be the exact pool account;
-- no ordinary user/workspace wallet may be retyped by an insert path.
CREATE FUNCTION workforce_funding_pool_account_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a credit_accounts%ROWTYPE;
BEGIN
  SELECT * INTO a FROM credit_accounts WHERE id=NEW.account_id;
  IF NOT FOUND OR a.user_id <> NEW.account_owner_id OR a.owner_kind <> 'project_pool' THEN
    RAISE EXCEPTION 'funding pool requires a project_pool ledger account' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER workforce_funding_pool_account_guard BEFORE INSERT OR UPDATE ON workforce_funding_pools
FOR EACH ROW EXECUTE FUNCTION workforce_funding_pool_account_guard();

DO $path$
BEGIN
  EXECUTE format('ALTER FUNCTION %I.workforce_funding_immutable() SET search_path = %I, pg_temp', current_schema(), current_schema());
  EXECUTE format('ALTER FUNCTION %I.workforce_funding_pool_account_guard() SET search_path = %I, pg_temp', current_schema(), current_schema());
END;
$path$;

-- Snapshot identity and commercial terms cannot be retargeted after opening.
CREATE FUNCTION workforce_funding_terms_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE campaign_state text;
BEGIN
  IF TG_OP='DELETE' OR TG_OP='TRUNCATE' THEN
    RAISE EXCEPTION 'funding records are retained' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='workforce_funding_campaigns' THEN
    IF (to_jsonb(NEW)-'status'-'revision'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'revision'-'updated_at') THEN
      RAISE EXCEPTION 'campaign terms are immutable; publish new terms separately' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='workforce_funding_milestones' THEN
    IF TG_OP='INSERT' THEN
      SELECT status INTO campaign_state FROM workforce_funding_campaigns WHERE id=NEW.campaign_id FOR SHARE;
      IF campaign_state IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'milestones are declared before opening' USING ERRCODE='23514'; END IF;
    ELSIF (to_jsonb(NEW)-'status'-'revision'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'revision'-'updated_at') THEN
      RAISE EXCEPTION 'milestone terms are immutable' USING ERRCODE='23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'funding provenance is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workforce_campaign_terms BEFORE UPDATE OR DELETE ON workforce_funding_campaigns FOR EACH ROW EXECUTE FUNCTION workforce_funding_terms_guard();
CREATE TRIGGER workforce_campaign_retained BEFORE TRUNCATE ON workforce_funding_campaigns FOR EACH STATEMENT EXECUTE FUNCTION workforce_funding_terms_guard();
CREATE TRIGGER workforce_milestone_terms BEFORE INSERT OR UPDATE OR DELETE ON workforce_funding_milestones FOR EACH ROW EXECUTE FUNCTION workforce_funding_terms_guard();
CREATE TRIGGER workforce_milestone_retained BEFORE TRUNCATE ON workforce_funding_milestones FOR EACH STATEMENT EXECUTE FUNCTION workforce_funding_terms_guard();
CREATE TRIGGER workforce_pool_immutable BEFORE UPDATE OR DELETE ON workforce_funding_pools FOR EACH ROW EXECUTE FUNCTION workforce_funding_terms_guard();
CREATE TRIGGER workforce_pool_retained BEFORE TRUNCATE ON workforce_funding_pools FOR EACH STATEMENT EXECUTE FUNCTION workforce_funding_terms_guard();
CREATE TRIGGER workforce_quarantine_immutable BEFORE UPDATE OR DELETE ON workforce_funding_origin_quarantine FOR EACH ROW EXECUTE FUNCTION workforce_funding_terms_guard();
CREATE TRIGGER workforce_quarantine_retained BEFORE TRUNCATE ON workforce_funding_origin_quarantine FOR EACH STATEMENT EXECUTE FUNCTION workforce_funding_terms_guard();
CREATE TRIGGER workforce_returns_immutable BEFORE UPDATE OR DELETE ON workforce_funding_returns FOR EACH ROW EXECUTE FUNCTION workforce_funding_terms_guard();
CREATE TRIGGER workforce_returns_retained BEFORE TRUNCATE ON workforce_funding_returns FOR EACH STATEMENT EXECUTE FUNCTION workforce_funding_terms_guard();
CREATE TRIGGER workforce_return_lots_immutable BEFORE UPDATE OR DELETE ON workforce_funding_return_lots FOR EACH ROW EXECUTE FUNCTION workforce_funding_terms_guard();
CREATE TRIGGER workforce_return_lots_retained BEFORE TRUNCATE ON workforce_funding_return_lots FOR EACH STATEMENT EXECUTE FUNCTION workforce_funding_terms_guard();
CREATE TRIGGER workforce_lots_immutable BEFORE UPDATE OR DELETE ON workforce_contribution_lots FOR EACH ROW EXECUTE FUNCTION workforce_funding_terms_guard();
CREATE TRIGGER workforce_lots_retained BEFORE TRUNCATE ON workforce_contribution_lots FOR EACH STATEMENT EXECUTE FUNCTION workforce_funding_terms_guard();
CREATE TRIGGER workforce_contribution_retained BEFORE DELETE ON workforce_funding_contributions FOR EACH ROW EXECUTE FUNCTION workforce_funding_terms_guard();
CREATE TRIGGER workforce_contribution_no_truncate BEFORE TRUNCATE ON workforce_funding_contributions FOR EACH STATEMENT EXECUTE FUNCTION workforce_funding_terms_guard();

CREATE FUNCTION workforce_contribution_lot_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE contribution_state text;
BEGIN
  SELECT state INTO contribution_state FROM workforce_funding_contributions WHERE id=NEW.contribution_id FOR UPDATE;
  IF contribution_state IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'origin lots may only attach to the pending contribution that creates them' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workforce_contribution_lot_insert BEFORE INSERT ON workforce_contribution_lots
  FOR EACH ROW EXECUTE FUNCTION workforce_contribution_lot_insert_guard();

CREATE FUNCTION workforce_contribution_balance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c record; total numeric; p record; bad integer;
BEGIN
  SELECT * INTO c FROM workforce_funding_contributions WHERE id=NEW.id;
  IF c.state='pending' THEN RAISE EXCEPTION 'pending contribution cannot commit without confirmed funding' USING ERRCODE='23514'; END IF;
  SELECT * INTO p FROM workforce_funding_pools WHERE campaign_id=c.campaign_id AND milestone_id=c.milestone_id;
  SELECT coalesce(sum(amount_micro),0) INTO total FROM workforce_contribution_lots WHERE contribution_id=c.id;
  IF total<>c.amount_micro OR p.id IS NULL THEN RAISE EXCEPTION 'contribution lot total disagrees with receipt' USING ERRCODE='23514'; END IF;
  SELECT count(*) INTO bad FROM workforce_contribution_lots l
    LEFT JOIN credit_grants source ON source.id=l.origin_grant_id
    LEFT JOIN credit_grant_payment_origins o ON o.grant_id=source.id
    LEFT JOIN credit_grants dest ON dest.id=l.pool_grant_id
    WHERE l.contribution_id=c.id AND (source.id IS NULL OR o.grant_id IS NULL OR dest.id IS NULL
      OR source.user_id<>c.contributor_user_id OR dest.user_id<>p.id OR dest.account_id<>p.account_id
      OR dest.kind<>'contribution' OR dest.amount_micro<>l.amount_micro
      OR source.expires_at IS DISTINCT FROM dest.expires_at OR source.expires_at IS DISTINCT FROM l.origin_expires_at);
  IF bad<>0 THEN RAISE EXCEPTION 'contribution lineage or expiry mismatch' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER workforce_contribution_balance AFTER INSERT OR UPDATE ON workforce_funding_contributions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workforce_contribution_balance_guard();
DO $harden$ BEGIN
  EXECUTE format('ALTER FUNCTION %I.workforce_funding_terms_guard() SET search_path = %I, pg_temp',current_schema(),current_schema());
  EXECUTE format('ALTER FUNCTION %I.workforce_contribution_balance_guard() SET search_path = %I, pg_temp',current_schema(),current_schema());
  EXECUTE format('ALTER FUNCTION %I.workforce_contribution_lot_insert_guard() SET search_path = %I, pg_temp',current_schema(),current_schema());
END $harden$;

-- DOWN
-- Never silently discard financial provenance.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM workforce_contribution_lots)
     OR EXISTS (SELECT 1 FROM workforce_funding_contributions)
     OR EXISTS (SELECT 1 FROM workforce_funding_pools)
     OR EXISTS (SELECT 1 FROM workforce_funding_campaigns)
     OR EXISTS (SELECT 1 FROM workforce_funding_milestones) THEN
    RAISE EXCEPTION 'funding rollback refused: contribution or pool history exists' USING ERRCODE='23514';
  END IF;
END $$;
DROP TRIGGER workforce_funding_pool_account_guard ON workforce_funding_pools;
DROP FUNCTION workforce_funding_pool_account_guard();
DROP TRIGGER workforce_funding_contributions_guard ON workforce_funding_contributions;
DROP FUNCTION workforce_funding_immutable();
DROP TABLE workforce_funding_origin_quarantine;
DROP TABLE workforce_funding_return_lots;
DROP TABLE workforce_funding_returns;
DROP TABLE workforce_contribution_lots;
DROP TABLE workforce_funding_contributions;
DROP TABLE workforce_funding_pools;
DROP TABLE workforce_funding_milestones;
DROP TABLE workforce_funding_campaigns;
DROP FUNCTION workforce_funding_terms_guard();
DROP FUNCTION workforce_contribution_balance_guard();
DROP FUNCTION workforce_contribution_lot_insert_guard();
