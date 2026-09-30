-- UP
-- XENO-WORKFORCE-01 §8.7 -- a PERSONAL (payer_kind='user') run's link to its root's one reservation.
-- Pool runs keep workforce_run_funding. The root reserves its ceiling as one canonical credit_holds
-- row (creditLedgerV2 holdV2Tx, in admission's transaction); a CHILD is a sub-reservation that names
-- the root's hold and reserves no new money. Every dispatch spends it through credit_hold_draws.
CREATE TABLE workforce_run_holds (
 admission_id uuid PRIMARY KEY REFERENCES workforce_run_admissions(id) ON DELETE RESTRICT,
 root_admission_id uuid NOT NULL REFERENCES workforce_run_admissions(id) ON DELETE RESTRICT,
 -- No FK: credit_holds is created by bootstrap after versioned migrations (see credit_hold_funding).
 hold_row_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX workforce_run_holds_root_hold ON workforce_run_holds(hold_row_id) WHERE admission_id=root_admission_id;
CREATE TRIGGER workforce_run_holds_retained BEFORE UPDATE OR DELETE ON workforce_run_holds
 FOR EACH ROW EXECUTE FUNCTION workforce_run_admission_immutable();

-- DOWN
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM workforce_run_holds) THEN
  RAISE EXCEPTION 'run hold rollback refused: retained reservations exist' USING ERRCODE='23514';
 END IF;
END $$;
DROP TABLE workforce_run_holds;
