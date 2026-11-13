-- Spawn backup: the ACCOUNT wrap of the backup data key (wrap type 0x03), the iCloud model.
--
-- Owner, 2026-11-13 (typos corrected): "like how iCloud works correct? no need for an extra backup password right? the
-- account should act like it right?", then "iCloud model (Recommended)". This replaces "Encrypted on this PC" (2026-11-12).
-- Spec: xeno-spawn docs/specs/2026-10-23-account-profile-sync.md, item 2, "Amended 2026-11-13".
--
-- In standard mode the data key is also kept wrapped with a platform key-encryption key (SPAWN_BACKUP_KEK, held in the
-- backend's environment and the secrets store, never in this database or in Storage). A signed-in device of the account
-- can get it back; every unwrap is logged. Private mode (later) deletes the account wrap: that is a REAL delete, the one
-- exception to "a wrapped key is never rewritten", allowed for this kind only.
--
-- Additive: no existing row changes, and every existing CHECK still holds for device and recovery rows.

ALTER TABLE spawn_backup_keys ADD COLUMN IF NOT EXISTS kek_version INTEGER CHECK (kek_version IS NULL OR kek_version >= 1);

ALTER TABLE spawn_backup_keys DROP CONSTRAINT IF EXISTS spawn_backup_keys_kind_check;
ALTER TABLE spawn_backup_keys ADD CONSTRAINT spawn_backup_keys_kind_check CHECK (kind IN ('device','recovery','account'));
ALTER TABLE spawn_backup_keys DROP CONSTRAINT IF EXISTS spawn_backup_keys_account_shape;
ALTER TABLE spawn_backup_keys ADD CONSTRAINT spawn_backup_keys_account_shape CHECK (
  kind <> 'account' OR (device_id IS NULL AND public_key IS NULL AND wrapped_key IS NOT NULL AND kek_version IS NOT NULL
                        AND state IN ('current','superseded'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_spawn_backup_account_current ON spawn_backup_keys(user_id) WHERE kind = 'account' AND state = 'current';

-- The device that last unwrapped, per device: the first unwrap by a device is what needs a fresh sign-in and an email.
ALTER TABLE spawn_backup_key_events DROP CONSTRAINT IF EXISTS spawn_backup_key_events_kind_check;
ALTER TABLE spawn_backup_key_events ADD CONSTRAINT spawn_backup_key_events_kind_check
  CHECK (kind IN ('registered','first_device','approved','recovered','revoked','recovery_set',
                  'account_set','account_unwrapped','account_wrap_deleted'));
CREATE INDEX IF NOT EXISTS idx_spawn_backup_key_events_unwrap ON spawn_backup_key_events(user_id, device_id) WHERE kind = 'account_unwrapped';

-- A key record may be DELETED only when it is an account wrap (private mode). Device and recovery envelopes never are,
-- except when the account itself is deleted (ON DELETE CASCADE: the user row is already gone by then).
CREATE OR REPLACE FUNCTION spawn_backup_key_no_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.kind = 'account' THEN RETURN OLD; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) THEN RETURN OLD; END IF; -- the account itself is being deleted
  RAISE EXCEPTION 'spawn backup: only the account wrap can be deleted' USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS spawn_backup_key_no_delete ON spawn_backup_keys;
CREATE TRIGGER spawn_backup_key_no_delete BEFORE DELETE ON spawn_backup_keys FOR EACH ROW EXECUTE FUNCTION spawn_backup_key_no_delete();

-- DOWN
DO $$ BEGIN
  IF to_regclass('spawn_backup_keys') IS NOT NULL AND EXISTS (SELECT 1 FROM spawn_backup_keys WHERE kind = 'account') THEN
    RAISE EXCEPTION 'account-wrap rollback refused: account wraps exist (dropping them makes standard-mode backups unreadable)' USING ERRCODE = 'check_violation';
  END IF;
END $$;
DROP TRIGGER IF EXISTS spawn_backup_key_no_delete ON spawn_backup_keys;
DROP FUNCTION IF EXISTS spawn_backup_key_no_delete();
DROP INDEX IF EXISTS idx_spawn_backup_key_events_unwrap;
ALTER TABLE spawn_backup_key_events DROP CONSTRAINT IF EXISTS spawn_backup_key_events_kind_check;
ALTER TABLE spawn_backup_key_events ADD CONSTRAINT spawn_backup_key_events_kind_check
  CHECK (kind IN ('registered','first_device','approved','recovered','revoked','recovery_set'));
DROP INDEX IF EXISTS uq_spawn_backup_account_current;
ALTER TABLE spawn_backup_keys DROP CONSTRAINT IF EXISTS spawn_backup_keys_account_shape;
ALTER TABLE spawn_backup_keys DROP CONSTRAINT IF EXISTS spawn_backup_keys_kind_check;
ALTER TABLE spawn_backup_keys ADD CONSTRAINT spawn_backup_keys_kind_check CHECK (kind IN ('device','recovery'));
ALTER TABLE spawn_backup_keys DROP COLUMN IF EXISTS kek_version;
