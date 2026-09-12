-- UP
-- Automatic retries stop at max_attempts. An authenticated editor may explicitly
-- authorize one additional claim without erasing the real attempt count or
-- weakening the automatic retry bound.
ALTER TABLE chat_scheduled_runs
  ADD COLUMN IF NOT EXISTS manual_retry_authorized BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN chat_scheduled_runs.manual_retry_authorized IS
  'Single-use authorization set by the editor retry route; consumed atomically when the worker claims the run.';
