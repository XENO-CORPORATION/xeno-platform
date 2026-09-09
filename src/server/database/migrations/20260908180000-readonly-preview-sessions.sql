-- Additive: old standard browser sessions retain their original authority.
--
-- Every statement is replay-safe by SQL guard, not by a swallowed exception.
-- Startup now rejects duplicate-object errors instead of treating them as
-- success (DATA-1), so a bare ADD CONSTRAINT would turn "restore a pre-migration
-- backup, then re-apply" — the rollback rehearsal this release owes — into a
-- backend that refuses to boot.
ALTER TABLE browser_session_state ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'standard';
ALTER TABLE browser_session_state ADD COLUMN IF NOT EXISTS absolute_expires_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'browser_session_state'::regclass
       AND conname = 'browser_session_purpose_valid'
  ) THEN
    ALTER TABLE browser_session_state ADD CONSTRAINT browser_session_purpose_valid
      CHECK (purpose IN ('standard', 'preview_readonly'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'browser_session_state'::regclass
       AND conname = 'browser_preview_expiry_required'
  ) THEN
    ALTER TABLE browser_session_state ADD CONSTRAINT browser_preview_expiry_required
      CHECK (purpose <> 'preview_readonly' OR absolute_expires_at IS NOT NULL);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS browser_preview_expiry_idx ON browser_session_state(absolute_expires_at)
  WHERE purpose = 'preview_readonly';
