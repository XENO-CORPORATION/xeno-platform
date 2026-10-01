-- UP
-- Original settlement and consumption remain immutable. Corrections record a
-- monotonically decreasing priced target; source replay is durable, not time-limited.
CREATE TABLE IF NOT EXISTS credit_draw_corrections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 draw_row_id uuid NOT NULL REFERENCES credit_draw_consumption_receipts(draw_row_id) ON DELETE RESTRICT,
 correction_source_id text NOT NULL CHECK(length(correction_source_id) BETWEEN 8 AND 200),
 provider_receipt_id text NOT NULL CHECK(length(provider_receipt_id) BETWEEN 1 AND 200),
 provider text NOT NULL,
 provider_request_id text NOT NULL,
 model text NOT NULL,
 input_tokens bigint NOT NULL CHECK(input_tokens>=0),
 output_tokens bigint NOT NULL CHECK(output_tokens>=0),
 evidence_hash text NOT NULL CHECK(evidence_hash ~ '^[a-f0-9]{64}$'),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 original_charged_micro bigint NOT NULL CHECK(original_charged_micro>=0),
 previous_net_micro bigint NOT NULL CHECK(previous_net_micro>=0),
 corrected_priced_micro bigint NOT NULL CHECK(corrected_priced_micro>=0),
 correction_micro bigint NOT NULL CHECK(correction_micro>0),
 restored_micro bigint NOT NULL CHECK(restored_micro>=0),
 liability_micro bigint NOT NULL CHECK(liability_micro>=0),
 actor_service text NOT NULL CHECK(length(actor_service) BETWEEN 1 AND 128),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(draw_row_id,correction_source_id),
 -- A single provider receipt cannot correct two dispatches.
 UNIQUE(actor_service,provider,provider_receipt_id),
 CHECK(correction_micro=restored_micro+liability_micro),
 CHECK(corrected_priced_micro+correction_micro=previous_net_micro),
 CHECK(previous_net_micro<=original_charged_micro)
);
CREATE TABLE IF NOT EXISTS credit_draw_correction_lots (
 correction_id uuid NOT NULL REFERENCES credit_draw_corrections(id) ON DELETE RESTRICT,
 draw_row_id uuid NOT NULL,
 grant_id uuid NOT NULL,
 correction_order integer NOT NULL CHECK(correction_order>=0),
 amount_micro bigint NOT NULL CHECK(amount_micro>0),
 outcome text NOT NULL CHECK(outcome IN ('restored','liability')),
 reason text NOT NULL CHECK(reason IN ('eligible','expired','quarantined','frozen','returned','source_unavailable')),
 PRIMARY KEY(correction_id,grant_id),
 UNIQUE(correction_id,correction_order),
 FOREIGN KEY(draw_row_id,grant_id) REFERENCES credit_draw_consumption_lots(draw_row_id,grant_id) ON DELETE RESTRICT,
 CHECK((outcome='restored')=(reason='eligible'))
);
CREATE INDEX IF NOT EXISTS credit_draw_correction_lots_source ON credit_draw_correction_lots(draw_row_id,grant_id);

CREATE OR REPLACE FUNCTION credit_draw_correction_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d record; total numeric; net numeric; r record; consumed bigint;
BEGIN
 IF TG_TABLE_NAME='credit_draw_corrections' THEN
  SELECT * INTO d FROM credit_hold_draws WHERE id=NEW.draw_row_id FOR UPDATE;
  IF NOT FOUND OR d.state<>'settled' OR d.outcome<>'unmeasured' OR d.resolved_at IS NULL
    OR clock_timestamp()>=d.resolved_at+interval '72 hours' THEN
   RAISE EXCEPTION 'correction requires an unmeasured draw within 72 hours' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(sum(correction_micro),0) INTO total FROM credit_draw_corrections WHERE draw_row_id=d.id;
  net := d.charged_micro-total;
  IF NEW.original_charged_micro<>d.charged_micro OR NEW.previous_net_micro<>net
    OR NEW.corrected_priced_micro>=net OR NEW.correction_micro<>net-NEW.corrected_priced_micro
    OR NEW.provider IS DISTINCT FROM d.provider OR NEW.provider_request_id IS DISTINCT FROM d.provider_request_id
    OR NEW.model IS DISTINCT FROM d.model
    OR NEW.corrected_priced_micro IS DISTINCT FROM
      ((d.tariff->>'inputMicroPerToken')::numeric*NEW.input_tokens
       +(d.tariff->>'outputMicroPerToken')::numeric*NEW.output_tokens) THEN
   RAISE EXCEPTION 'correction must decrease the exact original dispatch charge' USING ERRCODE='23514';
  END IF;
  NEW.created_at := clock_timestamp();
 ELSE
  SELECT * INTO r FROM credit_draw_corrections WHERE id=NEW.correction_id;
  IF NOT FOUND OR r.draw_row_id<>NEW.draw_row_id THEN
   RAISE EXCEPTION 'correction allocation identity mismatch' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM credit_hold_draws WHERE id=r.draw_row_id FOR UPDATE;
  SELECT consumed_micro INTO consumed FROM credit_draw_consumption_lots WHERE draw_row_id=NEW.draw_row_id AND grant_id=NEW.grant_id;
  SELECT coalesce(sum(amount_micro),0) INTO total FROM credit_draw_correction_lots WHERE draw_row_id=NEW.draw_row_id AND grant_id=NEW.grant_id;
  IF consumed IS NULL OR total+NEW.amount_micro>consumed THEN
   RAISE EXCEPTION 'corrections exceed consumed original lot' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION credit_draw_correction_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; r record; total numeric; restored numeric; liability numeric;
BEGIN
 IF TG_TABLE_NAME='credit_draw_corrections' THEN target:=NEW.id; ELSE target:=NEW.correction_id; END IF;
 SELECT * INTO r FROM credit_draw_corrections WHERE id=target;
 SELECT coalesce(sum(amount_micro),0),coalesce(sum(amount_micro) FILTER(WHERE outcome='restored'),0),
   coalesce(sum(amount_micro) FILTER(WHERE outcome='liability'),0)
 INTO total,restored,liability FROM credit_draw_correction_lots WHERE correction_id=target;
 IF total<>r.correction_micro OR restored<>r.restored_micro OR liability<>r.liability_micro THEN
  RAISE EXCEPTION 'correction requires complete reversing allocations' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION credit_draw_correction_retained() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'draw corrections are immutable and retained' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS credit_draw_correction_insert ON credit_draw_corrections;
CREATE TRIGGER credit_draw_correction_insert BEFORE INSERT ON credit_draw_corrections FOR EACH ROW EXECUTE FUNCTION credit_draw_correction_guard();
DROP TRIGGER IF EXISTS credit_draw_correction_lot_insert ON credit_draw_correction_lots;
CREATE TRIGGER credit_draw_correction_lot_insert BEFORE INSERT ON credit_draw_correction_lots FOR EACH ROW EXECUTE FUNCTION credit_draw_correction_guard();
DROP TRIGGER IF EXISTS credit_draw_corrections_retained ON credit_draw_corrections;
CREATE TRIGGER credit_draw_corrections_retained BEFORE UPDATE OR DELETE ON credit_draw_corrections FOR EACH ROW EXECUTE FUNCTION credit_draw_correction_retained();
DROP TRIGGER IF EXISTS credit_draw_corrections_no_truncate ON credit_draw_corrections;
CREATE TRIGGER credit_draw_corrections_no_truncate BEFORE TRUNCATE ON credit_draw_corrections FOR EACH STATEMENT EXECUTE FUNCTION credit_draw_correction_retained();
DROP TRIGGER IF EXISTS credit_draw_correction_lots_retained ON credit_draw_correction_lots;
CREATE TRIGGER credit_draw_correction_lots_retained BEFORE UPDATE OR DELETE ON credit_draw_correction_lots FOR EACH ROW EXECUTE FUNCTION credit_draw_correction_retained();
DROP TRIGGER IF EXISTS credit_draw_correction_lots_no_truncate ON credit_draw_correction_lots;
CREATE TRIGGER credit_draw_correction_lots_no_truncate BEFORE TRUNCATE ON credit_draw_correction_lots FOR EACH STATEMENT EXECUTE FUNCTION credit_draw_correction_retained();
DROP TRIGGER IF EXISTS credit_draw_correction_header_complete ON credit_draw_corrections;
CREATE CONSTRAINT TRIGGER credit_draw_correction_header_complete AFTER INSERT ON credit_draw_corrections
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION credit_draw_correction_complete();
DROP TRIGGER IF EXISTS credit_draw_correction_lots_complete ON credit_draw_correction_lots;
CREATE CONSTRAINT TRIGGER credit_draw_correction_lots_complete AFTER INSERT ON credit_draw_correction_lots
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION credit_draw_correction_complete();
DO $harden$ BEGIN
 EXECUTE format('ALTER FUNCTION %I.credit_draw_correction_retained() SET search_path = %I, pg_temp',current_schema(),current_schema());
 EXECUTE format('ALTER FUNCTION %I.credit_draw_correction_guard() SET search_path = %I, pg_temp',current_schema(),current_schema());
 EXECUTE format('ALTER FUNCTION %I.credit_draw_correction_complete() SET search_path = %I, pg_temp',current_schema(),current_schema());
END $harden$;

-- DOWN
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM credit_draw_corrections) THEN
  RAISE EXCEPTION 'draw correction rollback refused: retained state exists' USING ERRCODE='23514';
 END IF;
END $$;
DROP TABLE credit_draw_correction_lots;
DROP TABLE credit_draw_corrections;
DROP FUNCTION credit_draw_correction_retained();
DROP FUNCTION credit_draw_correction_guard();
DROP FUNCTION credit_draw_correction_complete();
