-- UP
-- RUN-09: direct provider TUI sessions that cannot enforce pooled-budget
-- admission must not charge a project pool. Adapters record enforceability;
-- funded-native parity can only be claimed on enforceable adapters (schema
-- pinned); personal/BYOK operation runs under its own explicit accepted
-- policy; every admitted charge is recorded with its basis.
CREATE TABLE IF NOT EXISTS provider_session_adapters (
  name TEXT PRIMARY KEY,
  enforceable BOOLEAN NOT NULL DEFAULT FALSE,
  parity_claim TEXT CHECK (parity_claim IS NULL OR parity_claim = 'funded-native'),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (parity_claim IS NULL OR enforceable = TRUE)
);
CREATE TABLE IF NOT EXISTS byok_policy_acceptances (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  policy_version TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS session_budget_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_kind TEXT NOT NULL CHECK (session_kind IN ('tui-direct', 'managed')),
  adapter_name TEXT REFERENCES provider_session_adapters(name) ON DELETE RESTRICT,
  target TEXT NOT NULL CHECK (target IN ('project-pool', 'personal')),
  pool_id UUID,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_micro BIGINT NOT NULL CHECK (amount_micro > 0),
  admitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((target = 'project-pool') = (pool_id IS NOT NULL))
);
-- DOWN
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM session_budget_charges) THEN
    RAISE EXCEPTION 'session charge rollback refused: charges exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM byok_policy_acceptances) THEN
    RAISE EXCEPTION 'byok rollback refused: acceptances exist' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM provider_session_adapters) THEN
    RAISE EXCEPTION 'adapter rollback refused: adapters exist' USING ERRCODE='23514';
  END IF;
  DROP TABLE session_budget_charges;
  DROP TABLE byok_policy_acceptances;
  DROP TABLE provider_session_adapters;
END $$;
