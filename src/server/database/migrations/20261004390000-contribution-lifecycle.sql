-- UP
-- PUB-06: contributions move through eleven explicit states with every
-- transition recorded (author, source, destination, timestamp, revision,
-- rationale). The record opens proposed; the history table is
-- append-only by trigger law.
ALTER TABLE contributions DROP CONSTRAINT contributions_review_state_check;
UPDATE contributions SET review_state = 'proposed' WHERE review_state NOT IN
  ('proposed', 'admitted', 'in_progress', 'submitted', 'checks_pending', 'review',
   'changes_requested', 'accepted', 'rejected', 'withdrawn', 'integrated');
ALTER TABLE contributions ALTER COLUMN review_state SET DEFAULT 'proposed';
ALTER TABLE contributions ADD CONSTRAINT contributions_review_state_check CHECK (review_state IN
  ('proposed', 'admitted', 'in_progress', 'submitted', 'checks_pending', 'review',
   'changes_requested', 'accepted', 'rejected', 'withdrawn', 'integrated'));
CREATE TABLE IF NOT EXISTS contribution_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id UUID NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  rationale TEXT NOT NULL CHECK (length(btrim(rationale)) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_state <> to_state)
);
CREATE FUNCTION contribution_transition_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'transition history is immutable' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER contribution_transitions_immutable BEFORE UPDATE OR DELETE ON contribution_transitions
  FOR EACH ROW EXECUTE FUNCTION contribution_transition_immutable();
CREATE TRIGGER contribution_transitions_no_truncate BEFORE TRUNCATE ON contribution_transitions
  FOR EACH STATEMENT EXECUTE FUNCTION contribution_transition_immutable();
CREATE INDEX IF NOT EXISTS idx_contribution_transitions_record ON contribution_transitions(contribution_id, created_at);
DO $harden$ BEGIN
  EXECUTE format('ALTER FUNCTION %I.contribution_transition_immutable() SET search_path = %I, pg_temp',
    current_schema(), current_schema());
END $harden$;
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM contribution_transitions) THEN
    RAISE EXCEPTION 'lifecycle rollback refused: transitions exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM contributions WHERE review_state NOT IN ('pending', 'in-review', 'accepted', 'rejected', 'withdrawn')) THEN
    RAISE EXCEPTION 'lifecycle rollback refused: lifecycle states exist' USING ERRCODE='23514';
  END IF;
  DROP TRIGGER contribution_transitions_no_truncate ON contribution_transitions;
  DROP TRIGGER contribution_transitions_immutable ON contribution_transitions;
  DROP FUNCTION contribution_transition_immutable();
  DROP TABLE contribution_transitions;
  ALTER TABLE contributions DROP CONSTRAINT contributions_review_state_check;
  ALTER TABLE contributions ALTER COLUMN review_state SET DEFAULT 'pending';
  ALTER TABLE contributions ADD CONSTRAINT contributions_review_state_check CHECK (review_state IN
    ('pending', 'in-review', 'accepted', 'rejected', 'withdrawn'));
END $$;
