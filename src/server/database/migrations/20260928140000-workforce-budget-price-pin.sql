-- UP
-- Existing unpriced proposals are retained, never assigned a guessed historical
-- tariff. New priced proposals bind an internal immutable snapshot; admission
-- must refuse a legacy NULL rather than price it from today's table.
ALTER TABLE workforce_funding_budgets ADD COLUMN price_snapshot jsonb;
ALTER TABLE workforce_funding_budgets ADD CONSTRAINT workforce_budget_price_pin CHECK (
  price_snapshot IS NULL OR (
    jsonb_typeof(price_snapshot)='object'
    AND price_snapshot ?& ARRAY['version','schemaVersion','operation','model','unit','arithmetic','inputMicroPerToken','outputMicroPerToken']
    AND price_snapshot->>'version'=price_version
    AND price_snapshot->>'schemaVersion'='1'
    AND price_snapshot->>'operation'='chat.completion'
    AND price_snapshot->>'unit'='microcredit'
    AND price_snapshot->>'arithmetic'='integer-per-token-v1'
    AND length(price_snapshot->>'model') BETWEEN 1 AND 100
    AND price_snapshot->>'inputMicroPerToken' ~ '^(0|[1-9][0-9]{0,17})$'
    AND price_snapshot->>'outputMicroPerToken' ~ '^(0|[1-9][0-9]{0,17})$'
  ) IS TRUE
);
-- The existing budget guard compares every immutable column, including this one.

-- DOWN
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM workforce_funding_budgets WHERE price_snapshot IS NOT NULL) THEN
    RAISE EXCEPTION 'price pin rollback refused: retained price consent exists' USING ERRCODE='23514';
  END IF;
END $$;
ALTER TABLE workforce_funding_budgets DROP CONSTRAINT workforce_budget_price_pin;
ALTER TABLE workforce_funding_budgets DROP COLUMN price_snapshot;
