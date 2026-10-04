-- UP
-- FORGE-05: authenticated webhook deliveries with durable dedupe and
-- ordered reconcile, stable outbound references, installation
-- standing with binding cascade, and per-repository revocation.
CREATE TABLE IF NOT EXISTS forge_webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES github_installations(installation_id) ON DELETE CASCADE,
  seq BIGINT NOT NULL CHECK (seq >= 1),
  event TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  body JSONB NOT NULL,
  outcome JSONB NOT NULL DEFAULT '{}'::jsonb,
  state TEXT NOT NULL CHECK (state IN ('applied', 'pending', 'duplicate', 'stale', 'conflict')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (installation_id, seq)
);
CREATE TABLE IF NOT EXISTS forge_webhook_sequences (
  installation_id TEXT PRIMARY KEY REFERENCES github_installations(installation_id) ON DELETE CASCADE,
  last_applied_seq BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS forge_outbound_ops (
  external_ref TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES github_installations(installation_id) ON DELETE CASCADE,
  op TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'confirmed', 'failed')),
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS installation_repo_revocations (
  installation_id TEXT NOT NULL REFERENCES github_installations(installation_id) ON DELETE CASCADE,
  repository TEXT NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, repository)
);
ALTER TABLE github_installations ADD COLUMN IF NOT EXISTS uninstalled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE github_installations ADD COLUMN IF NOT EXISTS uninstalled_at TIMESTAMPTZ NULL;
ALTER TABLE forge_bindings ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'available'
  CHECK (status IN ('available', 'unavailable'));
ALTER TABLE forge_bindings ADD COLUMN IF NOT EXISTS unavailable_reason TEXT NULL;
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM forge_webhook_deliveries) THEN
    RAISE EXCEPTION 'webhook rollback refused: deliveries exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM forge_outbound_ops WHERE status = 'unknown') THEN
    RAISE EXCEPTION 'webhook rollback refused: unknown ops exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM forge_outbound_ops) THEN
    RAISE EXCEPTION 'webhook rollback refused: ops exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM installation_repo_revocations) THEN
    RAISE EXCEPTION 'webhook rollback refused: revocations exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM forge_bindings WHERE status = 'unavailable') THEN
    RAISE EXCEPTION 'webhook rollback refused: unavailable bindings exist' USING ERRCODE='23514';
  END IF;
  ALTER TABLE forge_bindings DROP COLUMN unavailable_reason;
  ALTER TABLE forge_bindings DROP COLUMN status;
  ALTER TABLE github_installations DROP COLUMN uninstalled_at;
  ALTER TABLE github_installations DROP COLUMN uninstalled;
  DROP TABLE installation_repo_revocations;
  DROP TABLE forge_outbound_ops;
  DROP TABLE forge_webhook_sequences;
  DROP TABLE forge_webhook_deliveries;
END $$;
