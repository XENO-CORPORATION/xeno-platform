-- UP
-- Spawn sync v2 (xeno-spawn/docs/specs/2026-10-23-account-profile-sync.md, "v2"; owner, 2026-11-12: "upload all session and
-- spawn profiles to the account on xenosystem ... periodic uploads of the session into our storage on xenosystem account ...
-- this way we can secure our full conversation session with the agents", and, asked how, "Encrypted on this PC").
--
-- 1. spawn_item_sync: projects and named sessions, the same contract as spawn_profile_sync (per-item rev, a stale base is a 409).
--    Nothing in them is a secret; folders are kept per device, because a path belongs to one PC.
-- 2. spawn_backup_keys / spawn_backup_key_events: the account data key, ONLY WRAPPED (once per approved device, to that device's
--    X25519 key, and once to a recovery key the person keeps). The server stores and hands back opaque bytes and holds no key.
--    A wrapped key is never overwritten: rotating the recovery record adds a row, and a device is revoked, never rewritten, so a
--    stolen token can at worst add noise, never replace or erase what the person's own devices wrote.
-- The ciphertext itself lives in the person's XENO Storage (one "Spawn backup" project folder), so it is metered and restorable
-- like every other file. This file only holds the keys' envelopes.

CREATE TABLE IF NOT EXISTS spawn_item_sync (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('project','session')),
  item_id     TEXT NOT NULL CHECK (item_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  rev         INTEGER NOT NULL DEFAULT 1 CHECK (rev >= 1),
  record      JSONB,
  deleted     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, item_id),
  CHECK (deleted OR record IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_spawn_item_sync_user ON spawn_item_sync(user_id, kind, updated_at DESC);

-- One row per device envelope, and recovery envelopes (device_id NULL). state: pending (public key only) -> approved (wrapped key
-- present) -> revoked. Only the transitions the trigger allows ever happen.
CREATE TABLE IF NOT EXISTS spawn_backup_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('device','recovery')),
  device_id     UUID,
  name          TEXT CHECK (name IS NULL OR length(name) <= 120),
  public_key    TEXT CHECK (public_key IS NULL OR public_key ~ '^[A-Za-z0-9_-]{43}$'),
  wrapped_key   TEXT CHECK (wrapped_key IS NULL OR (wrapped_key ~ '^[A-Za-z0-9_-]+$' AND length(wrapped_key) BETWEEN 16 AND 1024)),
  state         TEXT NOT NULL CHECK (state IN ('pending','approved','revoked','current','superseded')),
  approved_by   UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at   TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  CHECK ((kind = 'device') = (device_id IS NOT NULL)),
  CHECK (kind <> 'device' OR (public_key IS NOT NULL AND state IN ('pending','approved','revoked'))),
  CHECK (kind <> 'recovery' OR (wrapped_key IS NOT NULL AND state IN ('current','superseded'))),
  CHECK (state <> 'approved' OR wrapped_key IS NOT NULL),
  CHECK (state <> 'pending' OR wrapped_key IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_spawn_backup_device ON spawn_backup_keys(user_id, device_id) WHERE kind = 'device';
CREATE UNIQUE INDEX IF NOT EXISTS uq_spawn_backup_recovery_current ON spawn_backup_keys(user_id) WHERE kind = 'recovery' AND state = 'current';

CREATE TABLE IF NOT EXISTS spawn_backup_key_events (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('registered','first_device','approved','recovered','revoked','recovery_set')),
  device_id   UUID,
  by_device   UUID,
  at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_spawn_backup_key_events_user ON spawn_backup_key_events(user_id, at DESC);

-- A wrapped key, once written, is never changed; the only moves are pending -> approved (adding the wrapped key), approved or
-- pending -> revoked, and a recovery record current -> superseded. Deleting the account deletes its rows (ON DELETE CASCADE).
CREATE OR REPLACE FUNCTION spawn_backup_key_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.user_id <> OLD.user_id OR NEW.kind <> OLD.kind OR NEW.device_id IS DISTINCT FROM OLD.device_id
     OR NEW.public_key IS DISTINCT FROM OLD.public_key OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'spawn backup: a key record keeps its identity' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state = 'pending' AND NEW.state = 'approved' AND OLD.wrapped_key IS NULL AND NEW.wrapped_key IS NOT NULL THEN RETURN NEW; END IF;
  IF OLD.state IN ('pending','approved') AND NEW.state = 'revoked' AND NEW.wrapped_key IS NOT DISTINCT FROM OLD.wrapped_key THEN RETURN NEW; END IF;
  IF OLD.state = 'current' AND NEW.state = 'superseded' AND NEW.wrapped_key = OLD.wrapped_key THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'spawn backup: a wrapped key is never rewritten' USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS spawn_backup_key_guard ON spawn_backup_keys;
CREATE TRIGGER spawn_backup_key_guard BEFORE UPDATE ON spawn_backup_keys FOR EACH ROW EXECUTE FUNCTION spawn_backup_key_guard();

CREATE OR REPLACE FUNCTION spawn_backup_events_frozen() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'spawn backup: the key log never changes' USING ERRCODE = 'check_violation'; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS spawn_backup_events_frozen ON spawn_backup_key_events;
CREATE TRIGGER spawn_backup_events_frozen BEFORE UPDATE ON spawn_backup_key_events FOR EACH ROW EXECUTE FUNCTION spawn_backup_events_frozen();

-- DOWN
DO $$ BEGIN
  IF to_regclass('spawn_backup_keys') IS NOT NULL AND EXISTS (SELECT 1 FROM spawn_backup_keys) THEN
    RAISE EXCEPTION 'spawn sync v2 rollback refused: backup keys exist (dropping them makes every backup unreadable)' USING ERRCODE = 'check_violation';
  END IF;
END $$;
DROP TRIGGER IF EXISTS spawn_backup_events_frozen ON spawn_backup_key_events;
DROP TRIGGER IF EXISTS spawn_backup_key_guard ON spawn_backup_keys;
DROP FUNCTION IF EXISTS spawn_backup_events_frozen();
DROP FUNCTION IF EXISTS spawn_backup_key_guard();
DROP TABLE IF EXISTS spawn_backup_key_events;
DROP TABLE IF EXISTS spawn_backup_keys;
DROP TABLE IF EXISTS spawn_item_sync;
