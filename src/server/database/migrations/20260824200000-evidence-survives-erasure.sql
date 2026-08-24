-- Evidence must outlive the account it belongs to.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
--
-- `dataRetention.js` deliberately never prunes `checkout_consents` — it is the
-- proof a customer waived their statutory withdrawal right, and without it we
-- cannot rebut "I never agreed". That care was defeated by a foreign key.
--
-- Both `checkout_consents.user_id` and `download_grants.user_id` were
-- ON DELETE CASCADE, and account deletion is SELF-SERVICE (DELETE
-- /api/auth/account, gated only by the customer's own password). So:
--
--     buy  →  download  →  delete account  →  dispute the charge
--
-- and the evidence went with the account, on the customer's own initiative, at
-- exactly the moment it mattered. The same deletion erased the security audit of
-- which binaries that account had taken — the record a leaked-build
-- investigation or a chargeback works from.
--
-- ── WHAT THIS DOES ──────────────────────────────────────────────────────────
--
-- SET NULL instead of CASCADE, plus a keyed, non-reversible `subject_hash` so
-- the surviving row can still answer the one question it exists for: did THIS
-- claimant consent? See services/subjectHash.js for why an unkeyed digest of an
-- email is not a pseudonym.
--
-- Lawful basis for surviving an erasure request: GDPR Art. 17(3)(e), processing
-- necessary for the establishment, exercise or defence of legal claims. That
-- carve-out is narrow, so what survives is narrow — a digest, never an address.
--
-- Idempotent throughout: this runs against a database where the tables may have
-- been created hours ago by their own migrations.

-- NOTE: no BEGIN/COMMIT statements in this file, and that is not an omission.
-- `migrationRunner.js` wraps every migration in its own transaction, so ending
-- one here would leave everything after it running unwrapped -- here, the
-- indexes -- and a failure would change the schema with no `schema_migrations`
-- row written. None of the other 34 migrations declares transaction control.

-- ── 1 · checkout_consents ───────────────────────────────────────────────────

ALTER TABLE checkout_consents ADD COLUMN IF NOT EXISTS subject_hash TEXT;

-- user_id must become nullable before the FK can SET NULL. A NOT NULL column
-- with ON DELETE SET NULL is a constraint that can only fail: the delete would
-- error rather than anonymise, so account deletion would break outright.
ALTER TABLE checkout_consents ALTER COLUMN user_id DROP NOT NULL;

DO $$
DECLARE fk TEXT;
BEGIN
  SELECT conname INTO fk
    FROM pg_constraint
   WHERE conrelid = 'checkout_consents'::regclass
     AND contype = 'f'
     AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                          WHERE attrelid = 'checkout_consents'::regclass
                            AND attname = 'user_id')];
  IF fk IS NOT NULL THEN
    EXECUTE format('ALTER TABLE checkout_consents DROP CONSTRAINT %I', fk);
  END IF;
END $$;

ALTER TABLE checkout_consents
  ADD CONSTRAINT checkout_consents_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- ── 2 · download_grants ─────────────────────────────────────────────────────

ALTER TABLE download_grants ADD COLUMN IF NOT EXISTS subject_hash TEXT;
ALTER TABLE download_grants ALTER COLUMN user_id DROP NOT NULL;

DO $$
DECLARE fk TEXT;
BEGIN
  SELECT conname INTO fk
    FROM pg_constraint
   WHERE conrelid = 'download_grants'::regclass
     AND contype = 'f'
     AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                          WHERE attrelid = 'download_grants'::regclass
                            AND attname = 'user_id')];
  IF fk IS NOT NULL THEN
    EXECUTE format('ALTER TABLE download_grants DROP CONSTRAINT %I', fk);
  END IF;
END $$;

ALTER TABLE download_grants
  ADD CONSTRAINT download_grants_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- ── 3 · Lookup ──────────────────────────────────────────────────────────────
--
-- The access pattern is a support agent holding one email address and asking
-- "did this person consent?". Without an index that is a sequential scan of a
-- table designed to be kept forever.

CREATE INDEX IF NOT EXISTS idx_checkout_consents_subject
  ON checkout_consents(subject_hash) WHERE subject_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_download_grants_subject
  ON download_grants(subject_hash) WHERE subject_hash IS NOT NULL;


-- ── 4 · Backfill ────────────────────────────────────────────────────────────
--
-- NOT DONE HERE, and that is deliberate rather than an omission.
--
-- The digest is keyed by SUBJECT_HASH_SECRET, which lives in the application's
-- environment. Deriving it in SQL would mean writing the key into a statement —
-- and statement text is captured by pg_stat_statements and by slow-query logs,
-- so the secret would end up in two places nobody would think to scrub.
--
-- Rows written before this migration therefore have a NULL handle and are
-- matchable only while their account exists. At the time of writing no sale has
-- happened, so the set is empty; if that changes, backfill from the application
-- with scripts/backfill-subject-hashes.mjs rather than from psql.
