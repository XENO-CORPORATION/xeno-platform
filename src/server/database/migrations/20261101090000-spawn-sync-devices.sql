-- UP
-- The devices that sync Spawn profiles with an account (xeno-spawn/docs/specs/2026-10-23-account-profile-sync.md,
-- "Removal and the choice"). Each signed-in Spawn checks in after a sync, so the account page can say when each device
-- last synced and whether one has a choice waiting. A device id is the random id that Spawn mints once per device; the
-- name is the computer's name. No path, user name or credential is stored. Informational only: nothing reads it to decide
-- a sync. Additive.
CREATE TABLE IF NOT EXISTS spawn_sync_devices (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id     TEXT NOT NULL CHECK (device_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  name          TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  version       TEXT CHECK (version IS NULL OR char_length(version) <= 60),
  profiles      INTEGER NOT NULL DEFAULT 0 CHECK (profiles BETWEEN 0 AND 10000),
  conflicts     INTEGER NOT NULL DEFAULT 0 CHECK (conflicts BETWEEN 0 AND 10000),
  last_sync_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_spawn_sync_devices_user ON spawn_sync_devices(user_id, last_sync_at DESC);

-- DOWN
DROP TABLE IF EXISTS spawn_sync_devices;
