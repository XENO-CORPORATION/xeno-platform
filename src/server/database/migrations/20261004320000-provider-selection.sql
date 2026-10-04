-- UP
-- SES-08: provider/model availability is discovered through the existing
-- gateway catalog (no parallel registry here); selection and command
-- execution complete only on actual provider acknowledgements; native
-- commands carry their GUI support honestly, and native-only commands stay
-- visible as such instead of being simulated.
CREATE TABLE IF NOT EXISTS provider_native_commands (
  provider TEXT NOT NULL,
  command TEXT NOT NULL,
  gui_supported BOOLEAN NOT NULL DEFAULT FALSE,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, command)
);
CREATE TABLE IF NOT EXISTS provider_model_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  public_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'acked')),
  acked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS provider_command_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  selection_id UUID NOT NULL REFERENCES provider_model_selections(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  command TEXT NOT NULL,
  surface TEXT NOT NULL CHECK (surface IN ('gui', 'native')),
  nonce TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'acked')),
  receipt JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM provider_command_runs) THEN
    RAISE EXCEPTION 'command run rollback refused: runs exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM provider_model_selections) THEN
    RAISE EXCEPTION 'selection rollback refused: selections exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM provider_native_commands) THEN
    RAISE EXCEPTION 'native command rollback refused: commands exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE provider_command_runs;
  DROP TABLE provider_model_selections;
  DROP TABLE provider_native_commands;
END $$;
