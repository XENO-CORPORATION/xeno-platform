-- Additive: old standard browser sessions retain their original authority.
ALTER TABLE browser_session_state ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'standard';
ALTER TABLE browser_session_state ADD COLUMN IF NOT EXISTS absolute_expires_at timestamptz;
ALTER TABLE browser_session_state ADD CONSTRAINT browser_session_purpose_valid
  CHECK (purpose IN ('standard', 'preview_readonly'));
ALTER TABLE browser_session_state ADD CONSTRAINT browser_preview_expiry_required
  CHECK (purpose <> 'preview_readonly' OR absolute_expires_at IS NOT NULL);
CREATE INDEX IF NOT EXISTS browser_preview_expiry_idx ON browser_session_state(absolute_expires_at)
  WHERE purpose = 'preview_readonly';
