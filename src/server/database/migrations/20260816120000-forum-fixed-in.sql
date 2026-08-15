-- ============================================================================
-- Loop C's write-back (WP7).
--
-- The plan calls this the step everyone skips, and says why: a user who reports
-- something and never learns it mattered never reports again — and the archive
-- fills with open threads describing bugs that were fixed a year ago, which
-- actively misleads the next reader AND the next agent.
--
-- `resolved_at` / `resolved_by` already exist, but they mean "a human accepted
-- an answer". A shipped fix is a different fact: nobody answered the question,
-- the product changed. Reusing the same columns would make the two
-- indistinguishable, and the one query Loop D most wants — "what did we ship
-- fixes for" — would be unanswerable.
-- ============================================================================

ALTER TABLE forum_threads
  ADD COLUMN IF NOT EXISTS fixed_in_version TEXT,
  ADD COLUMN IF NOT EXISTS fixed_at TIMESTAMPTZ;

-- "What shipped a fix, and when" — the query the release runbook and Loop D
-- both read. Partial, because fixed threads will always be a small minority.
CREATE INDEX IF NOT EXISTS idx_forum_threads_fixed
  ON forum_threads (fixed_at DESC) WHERE fixed_at IS NOT NULL;
