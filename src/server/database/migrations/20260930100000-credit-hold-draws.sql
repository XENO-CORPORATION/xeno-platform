-- UP
-- A reservation spent in SLICES. A run's inference spend is a hierarchy of reservations, the shape
-- real-time charging converges on (RFC 8506 session credit-control: one reservation, granted/used
-- units per update, termination clears the rest; card manual capture: multicapture up to the
-- authorized amount). The run's root holds its ceiling once as a credit_holds row; every provider
-- dispatch opens a DRAW on that one hold -- never a second hold against the account -- and settles
-- it from measured usage (creditLedgerV2 openRunDrawV2 / settleRunDrawV2).
--
-- A LEDGER table: it references nothing above the ledger. The dispatching admission is recorded by
-- id (the workforce layer resolves and checks it); like credit_hold_funding it carries no FK to the
-- bootstrap-created credit_holds, and none to workforce tables, so the ledger stays installable on
-- its own (the money suites apply exactly this file).
CREATE TABLE IF NOT EXISTS credit_hold_draws (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 hold_row_id uuid NOT NULL,
 admission_id uuid NOT NULL,
 draw_id text NOT NULL CHECK(draw_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 -- RUN-03: a lease authorizes ONE new provider dispatch. The draw names the lease it consumed.
 lease_hash text NOT NULL UNIQUE CHECK(lease_hash ~ '^[a-f0-9]{64}$'),
 model text NOT NULL CHECK(length(model) BETWEEN 1 AND 100),
 -- FUND-07: priced from the tariff PINNED when the draw opened; a later tariff change never reprices it.
 tariff jsonb NOT NULL,
 price_version text NOT NULL,
 input_bound bigint NOT NULL CHECK(input_bound>=0),
 output_bound bigint NOT NULL CHECK(output_bound>=1),
 reserved_micro bigint NOT NULL CHECK(reserved_micro>0),
 state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','settled','voided')),
 -- 'measured' = the provider ran and reported usage; 'unmeasured' = it was sent and no count came
 -- back (charged at its authorized bound, never more); 'not_dispatched' = provably never sent.
 outcome text CHECK(outcome IN ('measured','unmeasured','not_dispatched')),
 provider text CHECK(provider IS NULL OR length(provider) BETWEEN 1 AND 50),
 provider_request_id text CHECK(provider_request_id IS NULL OR length(provider_request_id) BETWEEN 1 AND 200),
 input_tokens bigint CHECK(input_tokens IS NULL OR input_tokens>=0),
 output_tokens bigint CHECK(output_tokens IS NULL OR output_tokens>=0),
 priced_micro bigint NOT NULL DEFAULT 0 CHECK(priced_micro>=0),
 charged_micro bigint NOT NULL DEFAULT 0 CHECK(charged_micro>=0 AND charged_micro<=priced_micro),
 -- What no envelope covered: the platform's, never a charge past the ceiling the payer approved.
 liability_micro bigint NOT NULL DEFAULT 0 CHECK(liability_micro=priced_micro-charged_micro),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz,
 UNIQUE(hold_row_id,draw_id),
 CHECK((state='open')=(outcome IS NULL AND resolved_at IS NULL)),
 CHECK(state<>'settled' OR outcome IN ('measured','unmeasured')),
 CHECK(outcome IS DISTINCT FROM 'unmeasured' OR (input_tokens IS NULL AND output_tokens IS NULL AND priced_micro=reserved_micro)),
 CHECK(state<>'voided' OR (outcome='not_dispatched' AND priced_micro=0))
);
CREATE INDEX IF NOT EXISTS credit_hold_draws_open ON credit_hold_draws(hold_row_id) WHERE state='open';
CREATE INDEX IF NOT EXISTS credit_hold_draws_admission ON credit_hold_draws(admission_id);

-- A resolved draw is evidence of money moved (or provably not moved): it never changes again, and a
-- draw is never deleted or truncated. An open draw may only resolve or have its expiry moved forward.
CREATE OR REPLACE FUNCTION credit_hold_draws_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'credit_hold_draws rows are retained' USING ERRCODE='23514'; END IF;
 IF OLD.state<>'open' THEN RAISE EXCEPTION 'a resolved draw is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.hold_row_id<>OLD.hold_row_id OR NEW.admission_id<>OLD.admission_id OR NEW.draw_id<>OLD.draw_id
   OR NEW.request_hash<>OLD.request_hash OR NEW.lease_hash<>OLD.lease_hash OR NEW.model<>OLD.model OR NEW.tariff<>OLD.tariff
   OR NEW.price_version<>OLD.price_version OR NEW.input_bound<>OLD.input_bound
   OR NEW.output_bound<>OLD.output_bound OR NEW.reserved_micro<>OLD.reserved_micro
   OR NEW.created_at<>OLD.created_at THEN
  RAISE EXCEPTION 'a draw''s authorization terms are immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.state='open' AND NEW.expires_at<OLD.expires_at THEN
  RAISE EXCEPTION 'a draw''s expiry only moves forward' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS credit_hold_draws_guard ON credit_hold_draws;
CREATE TRIGGER credit_hold_draws_guard BEFORE UPDATE OR DELETE ON credit_hold_draws
 FOR EACH ROW EXECUTE FUNCTION credit_hold_draws_guard();
DROP TRIGGER IF EXISTS credit_hold_draws_no_truncate ON credit_hold_draws;
CREATE TRIGGER credit_hold_draws_no_truncate BEFORE TRUNCATE ON credit_hold_draws
 FOR EACH STATEMENT EXECUTE FUNCTION credit_hold_draws_guard();

-- DOWN
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM credit_hold_draws) THEN
  RAISE EXCEPTION 'run draw rollback refused: retained draws exist' USING ERRCODE='23514';
 END IF;
END $$;
DROP TABLE credit_hold_draws;
DROP FUNCTION credit_hold_draws_guard();
