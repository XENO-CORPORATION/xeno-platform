-- UP
-- Ledger audit fixes (2026-07-19). ADDITIVE + REVERSIBLE.
--
-- 1) inhouse_daily_usage — per-(user, UTC day) counter backing REAL enforcement
--    of the `inHouseDailyLimit` plan entitlement on the in-house (xeno-rt)
--    inference path (middleware/inHouseDailyLimit.js). The entitlement was
--    advertised on every plan (free = 50/day) but never enforced. Bumped with an
--    atomic INSERT ... ON CONFLICT ... count = count + 1 upsert; old rows are
--    harmless (tiny) and can be pruned by any retention job later.
CREATE TABLE IF NOT EXISTS inhouse_daily_usage (
  user_id uuid NOT NULL,
  day     date NOT NULL,
  count   int  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- 2) ledger_compensation_failures — durable record of a FAILED saga compensation
--    (e.g. workspace transfer: user debited, workspace grant failed, AND the
--    reversing entry also failed). Money is in a known-bad state and an operator
--    must reconcile; this table is what makes that state visible instead of a
--    silent .catch(() => {}). Written by services/walletService.js.
CREATE TABLE IF NOT EXISTS ledger_compensation_failures (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid,
  amount_micro bigint NOT NULL,
  txn_ref      varchar(128),
  reason       text,
  context      jsonb,
  resolved     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ledger_comp_failures_unresolved
  ON ledger_compensation_failures (created_at) WHERE resolved = false;

-- DOWN
DROP INDEX IF EXISTS idx_ledger_comp_failures_unresolved;
DROP TABLE IF EXISTS ledger_compensation_failures;
DROP TABLE IF EXISTS inhouse_daily_usage;
