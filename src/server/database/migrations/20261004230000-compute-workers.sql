-- UP
-- RES-03: contributed compute is an untrusted worker unless separately
-- qualified. Trust is schema-pinned (default untrusted, only explicit
-- qualification flips it with evidence); scheduling policy (isolation,
-- egress, device access, caps approval, input classification, credential
-- TTL) is enforced by the service and recorded per task.
CREATE TABLE IF NOT EXISTS compute_workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  isolation_class TEXT NOT NULL CHECK (isolation_class IN ('strong', 'weak', 'none')),
  egress_policy TEXT NOT NULL CHECK (egress_policy IN ('none', 'restricted', 'open')),
  device_access TEXT NOT NULL CHECK (device_access IN ('none', 'local')),
  trust TEXT NOT NULL DEFAULT 'untrusted' CHECK (trust IN ('untrusted', 'qualified')),
  qualification_evidence JSONB,
  qualified_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  qualified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (trust = 'untrusted' OR (qualification_evidence IS NOT NULL AND qualified_by_user_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS compute_worker_caps (
  worker_id UUID PRIMARY KEY REFERENCES compute_workers(id) ON DELETE CASCADE,
  max_cpu_millicores INTEGER NOT NULL CHECK (max_cpu_millicores > 0),
  max_memory_mb INTEGER NOT NULL CHECK (max_memory_mb > 0),
  max_seconds INTEGER NOT NULL CHECK (max_seconds > 0),
  approved_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS compute_task_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES compute_workers(id) ON DELETE RESTRICT,
  scheduler_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  input_classification TEXT NOT NULL CHECK (input_classification IN ('public', 'private')),
  credential_hash TEXT NOT NULL,
  credential_expires_at TIMESTAMPTZ NOT NULL,
  cpu_millicores INTEGER NOT NULL,
  memory_mb INTEGER NOT NULL,
  max_seconds INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_compute_task_runs_worker ON compute_task_runs(worker_id, created_at DESC);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM compute_task_runs) THEN
    RAISE EXCEPTION 'compute task rollback refused: task runs exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM compute_worker_caps) THEN
    RAISE EXCEPTION 'compute caps rollback refused: approved caps exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM compute_workers) THEN
    RAISE EXCEPTION 'compute worker rollback refused: workers exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE compute_task_runs;
  DROP TABLE compute_worker_caps;
  DROP TABLE compute_workers;
END $$;
