-- UP
-- PUB-07: bounty and paid task claims with single-winner semantics and
-- commit-and-reveal. One live claim per task by partial unique law;
-- idempotency keys make retries safe; the reveal preimage separates the
-- true solver from copies.
CREATE TABLE IF NOT EXISTS task_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  claimant_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  commitment TEXT NOT NULL CHECK (commitment ~ '^[a-f0-9]{64}$'),
  idempotency_key TEXT NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 128),
  state TEXT NOT NULL DEFAULT 'claimed'
    CHECK (state IN ('claimed', 'revealed', 'awarded', 'expired', 'released')),
  expires_at TIMESTAMPTZ NOT NULL,
  revealed_secret TEXT,
  winner_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  decided_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK ((state IN ('claimed', 'revealed')) = (decided_at IS NULL)),
  UNIQUE (task_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_claims_single_live
  ON task_claims (task_id) WHERE state IN ('claimed', 'revealed');
CREATE INDEX IF NOT EXISTS idx_task_claims_claimant ON task_claims(claimant_user_id, state);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM task_claims WHERE state IN ('claimed', 'revealed', 'awarded')) THEN
    RAISE EXCEPTION 'claim rollback refused: live claims exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM task_claims) THEN
    RAISE EXCEPTION 'claim rollback refused: claims exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE task_claims;
END $$;
