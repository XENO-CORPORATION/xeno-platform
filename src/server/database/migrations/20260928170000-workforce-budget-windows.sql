-- UP
-- A rolling spend ceiling is part of the independently approved immutable
-- proposal, never an app-local counter. NULL preserves existing decisions.
ALTER TABLE workforce_funding_budgets
 ADD COLUMN window_seconds integer,
 ADD COLUMN window_limit_micro bigint,
 ADD CONSTRAINT workforce_budget_window CHECK (
   (window_seconds IS NULL AND window_limit_micro IS NULL)
   OR (window_seconds IS NOT NULL AND window_limit_micro IS NOT NULL
       AND window_seconds BETWEEN 1 AND 31536000
       AND window_limit_micro>0 AND window_limit_micro<=maximum_micro
       AND per_run_micro<=window_limit_micro)
 );
-- workforce_funding_budget_guard compares all immutable columns automatically.

-- DOWN
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM workforce_funding_budgets WHERE window_seconds IS NOT NULL) THEN
   RAISE EXCEPTION 'budget window rollback refused: retained approvals exist' USING ERRCODE='23514';
 END IF;
END $$;
ALTER TABLE workforce_funding_budgets DROP CONSTRAINT workforce_budget_window;
ALTER TABLE workforce_funding_budgets DROP COLUMN window_seconds;
ALTER TABLE workforce_funding_budgets DROP COLUMN window_limit_micro;
