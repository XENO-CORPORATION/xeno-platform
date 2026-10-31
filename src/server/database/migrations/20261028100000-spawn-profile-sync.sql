-- UP
-- Spawn profile sync (spec: xeno-spawn/docs/specs/2026-10-23-account-profile-sync.md).
-- One row per (account, profile): the synced bundle is profile DEFINITIONS and
-- non-credential config only - vendor credential files and session transcripts
-- are excluded by the client and must never be stored here. Revision is the
-- optimistic-concurrency token: a write with a stale base revision is refused
-- (409 at the route), never merged silently.

CREATE TABLE IF NOT EXISTS spawn_profile_sync (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id  TEXT NOT NULL CHECK (profile_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  rev         INTEGER NOT NULL DEFAULT 1 CHECK (rev >= 1),
  bundle      JSONB,
  deleted     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, profile_id),
  CHECK (deleted OR bundle IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_spawn_profile_sync_user ON spawn_profile_sync(user_id, updated_at DESC);

-- DOWN
DROP TABLE IF EXISTS spawn_profile_sync;
