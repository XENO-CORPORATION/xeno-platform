-- UP
-- RES-04: worker-reported output binds job identity, input/output hashes,
-- cancellation and metering in a receipt that starts UNVERIFIED. Only a
-- verified receipt may ground task acceptance or settlement; verification
-- itself is recorded with method and verifier.
CREATE TABLE IF NOT EXISTS compute_task_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_run_id UUID NOT NULL REFERENCES compute_task_runs(id) ON DELETE RESTRICT,
  worker_id UUID NOT NULL REFERENCES compute_workers(id) ON DELETE RESTRICT,
  input_hash TEXT NOT NULL,
  output_hash TEXT NOT NULL,
  gpu_hours NUMERIC NOT NULL CHECK (gpu_hours >= 0),
  artifact_ref TEXT NOT NULL,
  consequential BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (status IN ('unverified', 'verified', 'rejected', 'cancelled')),
  verification_method TEXT CHECK (verification_method IS NULL OR verification_method IN ('artifact-hash', 'independent-reproduction')),
  verified_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'verified' OR (verification_method IS NOT NULL AND verified_by_user_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS compute_task_acceptances (
  receipt_id UUID PRIMARY KEY REFERENCES compute_task_receipts(id) ON DELETE RESTRICT,
  accepted_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE compute_task_runs ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE compute_task_runs ADD COLUMN IF NOT EXISTS cancelled_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT;
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM compute_task_acceptances) THEN
    RAISE EXCEPTION 'task acceptance rollback refused: acceptances exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM compute_task_receipts) THEN
    RAISE EXCEPTION 'task receipt rollback refused: receipts exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM compute_task_runs WHERE cancelled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'task cancel rollback refused: cancellations exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE compute_task_acceptances;
  DROP TABLE compute_task_receipts;
  ALTER TABLE compute_task_runs DROP COLUMN IF EXISTS cancelled_at;
  ALTER TABLE compute_task_runs DROP COLUMN IF EXISTS cancelled_by_user_id;
END $$;
