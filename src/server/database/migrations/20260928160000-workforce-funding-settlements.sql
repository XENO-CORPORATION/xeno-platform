-- UP
-- A final service-authenticated receipt closes one root reservation, including its
-- children. Token counts are evidence, never a caller-selected monetary amount.
CREATE TABLE workforce_funding_settlements (
 root_admission_id uuid PRIMARY KEY REFERENCES workforce_run_admissions(id) ON DELETE RESTRICT,
 event_id text NOT NULL UNIQUE CHECK(event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
 provider_request_id text NOT NULL CHECK(length(provider_request_id) BETWEEN 1 AND 200),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 provider text NOT NULL CHECK(length(provider) BETWEEN 1 AND 50),
 model text NOT NULL CHECK(length(model) BETWEEN 1 AND 100),
 price_version text NOT NULL,
 UNIQUE(provider,provider_request_id),
 input_tokens bigint NOT NULL CHECK(input_tokens>=0),
 output_tokens bigint NOT NULL CHECK(output_tokens>=0),
 priced_micro bigint NOT NULL CHECK(priced_micro>=0),
 charged_micro bigint NOT NULL CHECK(charged_micro>=0 AND charged_micro<=priced_micro),
 liability_micro bigint NOT NULL CHECK(liability_micro=priced_micro-charged_micro),
 state text NOT NULL CHECK(state IN ('settled','reconciliation_required')),
 CHECK((liability_micro=0)=(state='settled')),
 all_work_terminal boolean NOT NULL CHECK(all_work_terminal),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER workforce_funding_settlements_retained BEFORE UPDATE OR DELETE ON workforce_funding_settlements
 FOR EACH ROW EXECUTE FUNCTION workforce_run_admission_immutable();
CREATE TRIGGER workforce_funding_settlements_no_truncate BEFORE TRUNCATE ON workforce_funding_settlements
 FOR EACH STATEMENT EXECUTE FUNCTION workforce_run_admission_immutable();

-- DOWN
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM workforce_funding_settlements) THEN
  RAISE EXCEPTION 'settlement rollback refused: retained receipts exist' USING ERRCODE='23514';
 END IF;
END $$;
DROP TABLE workforce_funding_settlements;
