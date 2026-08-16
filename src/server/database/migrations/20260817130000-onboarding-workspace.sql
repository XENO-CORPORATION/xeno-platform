-- ═══════════════════════════════════════════════════════════════════════════
-- The workspace a user chose during onboarding.
--
-- This is NOT another survey answer. It decides how the platform lays itself
-- out for them, so it is read on sign-in by every surface that arranges a
-- workspace — which is why it gets its own column rather than living in the
-- `interests` array it replaces.
--
-- Deliberately TEXT and unconstrained: the value is a suite id ('creative',
-- 'office', 'developer', 'connect') or 'everything', and that list is owned by
-- the frontend catalog which gains entries as products ship. A CHECK
-- constraint here would mean a migration every time a suite is added, and the
-- failure mode of drift is an INSERT that errors in production rather than a
-- value the UI simply does not recognise.
--
-- NULL is meaningful: onboarding was skipped, and the platform should fall
-- back to its default layout rather than pretending a choice was made.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE user_onboarding ADD COLUMN IF NOT EXISTS workspace TEXT;

-- The aggregate this exists to answer: which workspace do people pick, and
-- does that predict who stays? Partial — a row still mid-flow is noise.
CREATE INDEX IF NOT EXISTS idx_user_onboarding_workspace
    ON user_onboarding(workspace) WHERE workspace IS NOT NULL;
