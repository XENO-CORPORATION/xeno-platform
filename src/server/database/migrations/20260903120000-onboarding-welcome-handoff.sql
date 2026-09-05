ALTER TABLE user_onboarding
  ADD COLUMN IF NOT EXISTS welcome_acknowledged_at TIMESTAMPTZ;

-- This screen did not exist for accounts that completed onboarding before this
-- migration. Mark those rows acknowledged so a release never interrupts an
-- established user's next session with a newly introduced first-run screen.
UPDATE user_onboarding
   SET welcome_acknowledged_at = COALESCE(completed_at, skipped_at, NOW()),
       updated_at = NOW()
 WHERE welcome_acknowledged_at IS NULL
   AND (completed_at IS NOT NULL OR skipped_at IS NOT NULL);
