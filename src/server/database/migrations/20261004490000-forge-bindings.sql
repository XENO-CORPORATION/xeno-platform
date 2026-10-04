-- UP
-- FORGE-02: bindings carry a mutable display label apart from their
-- stable (provider, remote_id) identity, and every rename/transfer
-- reconciliation is journaled.
ALTER TABLE forge_bindings ADD COLUMN IF NOT EXISTS display_name TEXT NULL
  CHECK (display_name IS NULL OR length(btrim(display_name)) BETWEEN 1 AND 200);
CREATE TABLE IF NOT EXISTS forge_binding_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  binding_id UUID NOT NULL REFERENCES forge_bindings(id) ON DELETE CASCADE,
  previous_installation_ref TEXT NULL,
  new_installation_ref TEXT NULL,
  previous_display_name TEXT NULL,
  new_display_name TEXT NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_forge_binding_transfers_binding
  ON forge_binding_transfers(binding_id, created_at);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM forge_binding_transfers) THEN
    RAISE EXCEPTION 'forge rollback refused: transfers exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM forge_bindings WHERE display_name IS NOT NULL) THEN
    RAISE EXCEPTION 'forge rollback refused: display names exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE forge_binding_transfers;
  ALTER TABLE forge_bindings DROP COLUMN display_name;
END $$;
