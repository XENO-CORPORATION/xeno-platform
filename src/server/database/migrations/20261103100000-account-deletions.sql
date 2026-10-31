-- Deleting your account has a 30-day grace period, as Settings has always promised. A row here is a person's request: until
-- erase_at they can change their mind, after it the leader erases them through the one erasure path (utils/gdprErasure.js). The
-- row stays afterwards, with no personal data of its own, as the record that it happened.
CREATE TABLE IF NOT EXISTS account_deletions (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  erase_at      TIMESTAMPTZ NOT NULL,
  erased_at     TIMESTAMPTZ,
  held_reason   TEXT CHECK (held_reason IS NULL OR length(held_reason) <= 200),   -- why the sweep did not erase yet
  CHECK (erase_at > requested_at)
);
CREATE INDEX IF NOT EXISTS idx_account_deletions_due ON account_deletions(erase_at) WHERE erased_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS account_deletions;
