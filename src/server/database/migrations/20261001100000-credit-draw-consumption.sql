-- UP
-- A resolved draw keeps its exact lot consumption even after reservation rows disappear.
-- Ledger-only: holds/grants are bootstrap-created, so their identifiers follow the
-- credit_hold_funding convention rather than introducing migration-order dependencies.
-- Absence on an older resolved draw means UNKNOWN, never an invented zero-charge receipt.
CREATE TABLE IF NOT EXISTS credit_draw_consumption_receipts (
 draw_row_id uuid PRIMARY KEY REFERENCES credit_hold_draws(id) ON DELETE RESTRICT,
 schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),
 hold_row_id uuid NOT NULL,
 admission_id uuid NOT NULL,
 account_id uuid NOT NULL,
 payer_user_id uuid NOT NULL,
 charged_micro bigint NOT NULL CHECK(charged_micro>=0),
 allocation_count integer NOT NULL CHECK(allocation_count>=0),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((charged_micro=0)=(allocation_count=0))
);
CREATE TABLE IF NOT EXISTS credit_draw_consumption_lots (
 draw_row_id uuid NOT NULL REFERENCES credit_draw_consumption_receipts(draw_row_id) ON DELETE RESTRICT,
 grant_id uuid NOT NULL,
 consumption_order integer NOT NULL CHECK(consumption_order>=0),
 consumed_micro bigint NOT NULL CHECK(consumed_micro>0),
 grant_kind text NOT NULL,
 grant_priority integer NOT NULL,
 grant_expires_at timestamptz,
 grant_source_ref text,
 grant_amount_micro bigint NOT NULL CHECK(grant_amount_micro>0),
 remaining_after_micro bigint NOT NULL CHECK(remaining_after_micro>=0),
 PRIMARY KEY(draw_row_id,grant_id),
 UNIQUE(draw_row_id,consumption_order),
 CHECK(remaining_after_micro+consumed_micro<=grant_amount_micro)
);

CREATE OR REPLACE FUNCTION credit_draw_consumption_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d record; h record; r record; g record; reserved bigint;
BEGIN
 SELECT * INTO d FROM credit_hold_draws WHERE id=NEW.draw_row_id FOR UPDATE;
 IF NOT FOUND OR d.state<>'open' THEN
  RAISE EXCEPTION 'consumption evidence requires an open draw' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='credit_draw_consumption_receipts' THEN
  SELECT * INTO h FROM credit_holds WHERE id=d.hold_row_id;
  IF NOT FOUND OR NEW.hold_row_id IS DISTINCT FROM d.hold_row_id
    OR NEW.admission_id IS DISTINCT FROM d.admission_id
    OR NEW.account_id IS DISTINCT FROM h.account_id OR NEW.payer_user_id IS DISTINCT FROM h.user_id THEN
   RAISE EXCEPTION 'consumption receipt identity mismatch' USING ERRCODE='23514';
  END IF;
 ELSE
  SELECT * INTO r FROM credit_draw_consumption_receipts WHERE draw_row_id=NEW.draw_row_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'consumption receipt required' USING ERRCODE='23514'; END IF;
  SELECT * INTO g FROM credit_grants WHERE id=NEW.grant_id FOR SHARE;
  IF NOT FOUND OR g.user_id IS DISTINCT FROM r.payer_user_id
    OR (g.account_id IS NOT NULL AND g.account_id IS DISTINCT FROM r.account_id)
    OR NEW.grant_kind IS DISTINCT FROM g.kind OR NEW.grant_priority IS DISTINCT FROM g.priority
    OR NEW.grant_expires_at IS DISTINCT FROM g.expires_at OR NEW.grant_source_ref IS DISTINCT FROM g.source_ref
    OR NEW.grant_amount_micro IS DISTINCT FROM g.amount_micro OR NEW.remaining_after_micro IS DISTINCT FROM g.remaining_micro THEN
   RAISE EXCEPTION 'consumption lot snapshot mismatch' USING ERRCODE='23514';
  END IF;
  SELECT reserved_micro INTO reserved FROM credit_hold_funding WHERE hold_row_id=r.hold_row_id AND grant_id=NEW.grant_id;
  IF NOT FOUND OR NEW.consumed_micro>reserved THEN
   RAISE EXCEPTION 'consumption lot exceeds reserved funding' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION credit_draw_consumption_retained() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'draw consumption evidence is immutable and retained' USING ERRCODE='23514';
END $$;
CREATE OR REPLACE FUNCTION credit_draw_consumption_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; d record; r record; amount numeric; count_lots bigint; first_order integer; last_order integer;
BEGIN
 IF TG_TABLE_NAME='credit_hold_draws' THEN target := NEW.id;
 ELSE target := NEW.draw_row_id; END IF;
 SELECT * INTO d FROM credit_hold_draws WHERE id=target;
 SELECT * INTO r FROM credit_draw_consumption_receipts WHERE draw_row_id=target;
 IF NOT FOUND OR d.state<>'settled' OR r.charged_micro IS DISTINCT FROM d.charged_micro
   OR r.hold_row_id IS DISTINCT FROM d.hold_row_id OR r.admission_id IS DISTINCT FROM d.admission_id THEN
  RAISE EXCEPTION 'settled draw requires complete consumption receipt' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(sum(consumed_micro),0),count(*),min(consumption_order),max(consumption_order)
  INTO amount,count_lots,first_order,last_order FROM credit_draw_consumption_lots WHERE draw_row_id=target;
 IF amount<>r.charged_micro OR count_lots<>r.allocation_count
   OR (count_lots>0 AND (first_order<>0 OR last_order<>count_lots-1)) THEN
  RAISE EXCEPTION 'draw consumption allocation total mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS credit_draw_receipt_insert ON credit_draw_consumption_receipts;
CREATE TRIGGER credit_draw_receipt_insert BEFORE INSERT ON credit_draw_consumption_receipts
 FOR EACH ROW EXECUTE FUNCTION credit_draw_consumption_insert_guard();
DROP TRIGGER IF EXISTS credit_draw_lot_insert ON credit_draw_consumption_lots;
CREATE TRIGGER credit_draw_lot_insert BEFORE INSERT ON credit_draw_consumption_lots
 FOR EACH ROW EXECUTE FUNCTION credit_draw_consumption_insert_guard();
DROP TRIGGER IF EXISTS credit_draw_receipt_retained ON credit_draw_consumption_receipts;
CREATE TRIGGER credit_draw_receipt_retained BEFORE UPDATE OR DELETE ON credit_draw_consumption_receipts
 FOR EACH ROW EXECUTE FUNCTION credit_draw_consumption_retained();
DROP TRIGGER IF EXISTS credit_draw_receipt_no_truncate ON credit_draw_consumption_receipts;
CREATE TRIGGER credit_draw_receipt_no_truncate BEFORE TRUNCATE ON credit_draw_consumption_receipts
 FOR EACH STATEMENT EXECUTE FUNCTION credit_draw_consumption_retained();
DROP TRIGGER IF EXISTS credit_draw_lot_retained ON credit_draw_consumption_lots;
CREATE TRIGGER credit_draw_lot_retained BEFORE UPDATE OR DELETE ON credit_draw_consumption_lots
 FOR EACH ROW EXECUTE FUNCTION credit_draw_consumption_retained();
DROP TRIGGER IF EXISTS credit_draw_lot_no_truncate ON credit_draw_consumption_lots;
CREATE TRIGGER credit_draw_lot_no_truncate BEFORE TRUNCATE ON credit_draw_consumption_lots
 FOR EACH STATEMENT EXECUTE FUNCTION credit_draw_consumption_retained();

-- Applies only to new transitions/inserts, never scans or certifies historical settled rows.
DROP TRIGGER IF EXISTS credit_draw_settlement_consumption ON credit_hold_draws;
CREATE CONSTRAINT TRIGGER credit_draw_settlement_consumption AFTER INSERT OR UPDATE ON credit_hold_draws
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.state='settled')
 EXECUTE FUNCTION credit_draw_consumption_complete();
DROP TRIGGER IF EXISTS credit_draw_receipt_complete ON credit_draw_consumption_receipts;
CREATE CONSTRAINT TRIGGER credit_draw_receipt_complete AFTER INSERT ON credit_draw_consumption_receipts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION credit_draw_consumption_complete();
DROP TRIGGER IF EXISTS credit_draw_lot_complete ON credit_draw_consumption_lots;
CREATE CONSTRAINT TRIGGER credit_draw_lot_complete AFTER INSERT ON credit_draw_consumption_lots
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION credit_draw_consumption_complete();
DO $harden$ BEGIN
 EXECUTE format('ALTER FUNCTION %I.credit_draw_consumption_insert_guard() SET search_path = %I, pg_temp',current_schema(),current_schema());
 EXECUTE format('ALTER FUNCTION %I.credit_draw_consumption_retained() SET search_path = %I, pg_temp',current_schema(),current_schema());
 EXECUTE format('ALTER FUNCTION %I.credit_draw_consumption_complete() SET search_path = %I, pg_temp',current_schema(),current_schema());
END $harden$;

-- DOWN
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM credit_draw_consumption_receipts) THEN
  RAISE EXCEPTION 'consumption rollback refused: retained evidence exists' USING ERRCODE='23514';
 END IF;
END $$;
DROP TRIGGER credit_draw_settlement_consumption ON credit_hold_draws;
DROP TABLE credit_draw_consumption_lots;
DROP TABLE credit_draw_consumption_receipts;
DROP FUNCTION credit_draw_consumption_complete();
DROP FUNCTION credit_draw_consumption_retained();
DROP FUNCTION credit_draw_consumption_insert_guard();
