/**
 * Account & Ledger v2 — ADDITIVE migration.
 *
 * Part of the XENO unified-account work (see `XENO ACCOUNT - ARCHITECTURE.md`).
 * STRICTLY ADDITIVE per the locked Identity Plan (R3): new tables only, never an
 * ALTER/DROP on a live table. Safe to run repeatedly (IF NOT EXISTS). The rich
 * ledger tables (credit_accounts, credit_transactions, api_usage_logs,
 * external_identity_links, pricing_tiers) already exist on live — this only adds
 * what's missing for v2: two-phase holds + the OIDC relying-party surface.
 *
 * Balances are integer MICRO-credits (verified live: 1 credit = 1_000_000 µcr).
 *
 *   node database/migrate-account-v2.js
 */
import pg from 'pg';

const { Pool } = pg;

const SQL = `
-- One migrator at a time: two backends start together, and this whole string runs as ONE implicit transaction
-- (a multi-statement simple query), so the lock holds to the end.
SELECT pg_advisory_xact_lock(hashtext('xeno-ledger-chain-v2-migration'));
-- Two-phase credit holds (reserve -> settle/void) for hard per-use gating.
CREATE TABLE IF NOT EXISTS credit_holds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  account_id    uuid,
  hold_id       text NOT NULL,              -- caller idempotency key
  surface       varchar(64) NOT NULL,
  operation     varchar(128) NOT NULL,
  amount_micro  bigint NOT NULL CHECK (amount_micro > 0),
  settled_micro bigint NOT NULL DEFAULT 0,
  state         varchar(16) NOT NULL DEFAULT 'held', -- held|settled|voided|expired
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, hold_id)
);
CREATE INDEX IF NOT EXISTS idx_credit_holds_active
  ON credit_holds (user_id, state) WHERE state = 'held';

-- Idempotency for direct usage debits: one transaction per (user, surface, txn id).
-- credit_transactions already exists; we add a partial unique index on its
-- reference fields so a replayed usage event no-ops instead of double-charging.
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_txn_ref
  ON credit_transactions (user_id, reference_type, reference_id)
  WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL;

-- ── OIDC relying-party surface (Identity Plan R3: new tables only) ──────────
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id      varchar(128) PRIMARY KEY,
  client_secret  text,                       -- null for public clients
  name           varchar(128) NOT NULL,
  redirect_uris  text[] NOT NULL DEFAULT '{}',
  allowed_scopes text[] NOT NULL DEFAULT '{openid,profile,email,ledger}',
  surface        varchar(64),                -- the branch's attribution tag
  is_first_party boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  code           text PRIMARY KEY,
  client_id      varchar(128) NOT NULL,
  user_id        uuid NOT NULL,
  redirect_uri   text NOT NULL,
  scope          text NOT NULL DEFAULT '',
  code_challenge text NOT NULL,              -- PKCE S256
  nonce          text,
  expires_at     timestamptz NOT NULL,
  consumed       boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_expiry ON oauth_authorization_codes (expires_at);

CREATE TABLE IF NOT EXISTS oauth_authorization_context (
  code       text PRIMARY KEY,
  auth_time  timestamptz NOT NULL,
  prompt     varchar(32),
  acr        text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  text NOT NULL UNIQUE,          -- sha256 of the opaque token
  client_id   varchar(128) NOT NULL,
  user_id     uuid NOT NULL,
  family_id   uuid NOT NULL,                 -- rotation lineage (reuse => revoke family)
  scope       text NOT NULL DEFAULT '',
  sid         uuid NOT NULL,                 -- session id (back-channel logout)
  rotated     boolean NOT NULL DEFAULT false,
  revoked     boolean NOT NULL DEFAULT false,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oauth_rt_family ON oauth_refresh_tokens (family_id);
-- Idempotent refresh recovery (XENO AUTH): the successor a rotation issued, and the sha256 of the
-- client's rotation_id, so a client killed before persisting the successor can retry without
-- tripping reuse detection. Also added by migration 20261031120000.
ALTER TABLE oauth_refresh_tokens ADD COLUMN IF NOT EXISTS successor_id uuid;
ALTER TABLE oauth_refresh_tokens ADD COLUMN IF NOT EXISTS rotation_id_hash text;
ALTER TABLE oauth_refresh_tokens ADD COLUMN IF NOT EXISTS issuer text; -- which provider issued it (staged issuer move)

-- OIDC access-token revocation without changing the live users/refresh tables.
-- Every minted SID is registered here with the user's revocation epoch. Access
-- validation requires an unrevoked row whose epoch still matches the user row.
CREATE TABLE IF NOT EXISTS oauth_user_auth_epochs (
  user_id     uuid PRIMARY KEY,
  epoch       bigint NOT NULL DEFAULT 0,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_session_state (
  sid         uuid PRIMARY KEY,
  user_id     uuid NOT NULL,
  auth_epoch  bigint NOT NULL,
  auth_time   timestamptz NOT NULL,
  dpop_jkt    text,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oauth_session_user
  ON oauth_session_state (user_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS oauth_dpop_replays (
  jkt         text NOT NULL,
  jti         text NOT NULL,
  htm         varchar(16) NOT NULL,
  htu         text NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (jkt, jti)
);

CREATE TABLE IF NOT EXISTS oauth_broker_installations (
  installation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL,
  public_jwk       jsonb NOT NULL,
  jkt              text NOT NULL,
  revoked_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, jkt)
);

CREATE TABLE IF NOT EXISTS oauth_broker_assertion_replays (
  installation_id uuid NOT NULL,
  jti              text NOT NULL,
  expires_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, jti)
);

CREATE TABLE IF NOT EXISTS oauth_device_codes (
  device_code   text PRIMARY KEY,
  user_code     varchar(16) NOT NULL UNIQUE,
  client_id     varchar(128) NOT NULL,
  scope         text NOT NULL DEFAULT '',
  user_id       uuid,                         -- set once approved
  approved      boolean NOT NULL DEFAULT false,
  denied        boolean NOT NULL DEFAULT false,
  interval_secs int NOT NULL DEFAULT 5,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- Where the device started the request (RFC 8628 §5.4). Also added by migration 20261028120000.
ALTER TABLE oauth_device_codes
  ADD COLUMN IF NOT EXISTS request_country CHAR(2) CHECK (request_country IS NULL OR request_country ~ '^[A-Z]{2}$');

CREATE TABLE IF NOT EXISTS oidc_signing_keys (
  kid         text PRIMARY KEY,
  alg         varchar(16) NOT NULL DEFAULT 'RS256',
  private_pem text NOT NULL,
  public_jwk  jsonb NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Credit grants = drawdown lots (Arch §4.7). Spend draws down lots in order:
-- priority ASC → soonest-expiry → free-before-paid → FIFO. balance = Σ remaining
-- of unexpired lots (credit_accounts.balance is the cached total).
CREATE TABLE IF NOT EXISTS credit_grants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  account_id    uuid,
  amount_micro    bigint NOT NULL,
  remaining_micro bigint NOT NULL,
  kind          varchar(16) NOT NULL DEFAULT 'paid',   -- free | promo | paid
  priority      int NOT NULL DEFAULT 100,              -- lower drains first
  source_ref    varchar(128),
  expires_at    timestamptz,                           -- null = never
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_grants_drawdown
  ON credit_grants (user_id, priority, expires_at, created_at) WHERE remaining_micro > 0;
-- One allowance grant per (user, source_ref). The weekly allowance (§8b) names its window
-- in the source_ref and is issued LAZILY on first use, so N concurrent first calls of a
-- window all pass the "does it exist?" SELECT before any of them INSERTs. A read cannot
-- make a write idempotent — only a constraint can.
--
-- Scoped to kind='allowance' DELIBERATELY. A unique index runs at startup, and one that
-- finds pre-existing duplicates throws inside runRequiredStartupMigrations — i.e. it takes
-- the backend down on deploy. 'allowance' is new here and has zero rows, so this index
-- cannot fail on historical data; widening it to every source_ref is a separate decision
-- that needs a duplicate sweep against production first.
CREATE UNIQUE INDEX IF NOT EXISTS uq_grants_allowance_window
  ON credit_grants (user_id, source_ref) WHERE kind = 'allowance' AND source_ref IS NOT NULL;

-- Payment origin is evidence, not the grant's kind or a caller-supplied source_ref.
-- Deliberately no historical backfill: old paid labels cannot prove settled value.
-- Kept beside credit_grants because that table is created after versioned migrations.
CREATE TABLE IF NOT EXISTS credit_grant_payment_origins (
  grant_id uuid PRIMARY KEY REFERENCES credit_grants(id) ON DELETE RESTRICT,
  provider_account text NOT NULL,
  provider_mode text NOT NULL CHECK (provider_mode IN ('test','live')),
  payment_intent text NOT NULL,
  checkout_session text NOT NULL,
  event_id text NOT NULL,
  paid_minor bigint NOT NULL CHECK (paid_minor > 0),
  currency text NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  amount_micro bigint NOT NULL CHECK (amount_micro > 0),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_account, provider_mode, payment_intent),
  UNIQUE(provider_account, provider_mode, checkout_session)
);
CREATE OR REPLACE FUNCTION credit_grant_payment_origin_guard() RETURNS trigger AS $origin$
DECLARE g credit_grants%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'payment origins are immutable; disputes are separate records' USING ERRCODE='23514';
  END IF;
  SELECT * INTO g FROM credit_grants WHERE id=NEW.grant_id;
  IF NOT FOUND OR g.kind <> 'paid' OR g.amount_micro <> NEW.amount_micro
     OR g.source_ref IS DISTINCT FROM 'stripe:checkout:' || NEW.checkout_session THEN
    RAISE EXCEPTION 'payment origin must describe the exact purchased lot' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$origin$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS credit_grant_payment_origins_guard ON credit_grant_payment_origins;
CREATE TRIGGER credit_grant_payment_origins_guard BEFORE INSERT OR UPDATE OR DELETE ON credit_grant_payment_origins
  FOR EACH ROW EXECUTE FUNCTION credit_grant_payment_origin_guard();
DROP TRIGGER IF EXISTS credit_grant_payment_origins_no_truncate ON credit_grant_payment_origins;
CREATE TRIGGER credit_grant_payment_origins_no_truncate BEFORE TRUNCATE ON credit_grant_payment_origins
  FOR EACH STATEMENT EXECUTE FUNCTION credit_grant_payment_origin_guard();
DO $origin_path$ BEGIN
  EXECUTE format('ALTER FUNCTION %I.credit_grant_payment_origin_guard() SET search_path = %I, pg_temp', current_schema(), current_schema());
END $origin_path$;

-- Spend caps as a settlement INVARIANT (Arch §4.6): a debit that would exceed the
-- window cap is rejected, not just alerted.
CREATE TABLE IF NOT EXISTS spend_caps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  window_sec  int NOT NULL,
  limit_micro bigint NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, window_sec)
);

-- Authorization (Arch §3): Zanzibar-style relationship tuples — object#relation@subject.
-- RBAC roles are modeled as relations; agents are subjects with a scoped relation.
-- Postgres MVP (swappable for OpenFGA later, exactly as the ledger is pre-TigerBeetle).
CREATE TABLE IF NOT EXISTS relationship_tuples (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type  varchar(64)  NOT NULL,
  object_id    varchar(128) NOT NULL,
  relation     varchar(64)  NOT NULL,
  subject_type varchar(64)  NOT NULL,
  subject_id   varchar(128) NOT NULL,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (object_type, object_id, relation, subject_type, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_reltuples_lookup
  ON relationship_tuples (object_type, object_id, subject_type, subject_id);

-- Back-channel logout (Arch §2.5): where the origin POSTs a signed Logout Token.
ALTER TABLE oauth_clients ADD COLUMN IF NOT EXISTS backchannel_logout_uri text;

-- Append-only enforcement at the DB level (Arch §4.2): credit_transactions can
-- only ever be INSERTed. Corrections = reversing entries, never edits. (Trigger,
-- not a role GRANT, because the app connects as a superuser which bypasses GRANTs.)
CREATE OR REPLACE FUNCTION credit_txn_immutable() RETURNS trigger AS $fn$
BEGIN RAISE EXCEPTION 'credit_transactions is append-only (Arch §4.2); use a reversing entry'; END;
$fn$ LANGUAGE plpgsql;

-- Additions on EXISTING live tables — guarded by to_regclass so the migration
-- is safe to run on a DB where those tables aren't present yet (e.g. tests).
DO $$ BEGIN
  -- Identity-by-(provider,subject): one (surface → canonical user) link, the
  -- idempotent upsert target for sign-in (Arch §2.1/§0.4 — "from where", not email).
  IF to_regclass('public.external_identity_links') IS NOT NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_eil_source_platform
      ON external_identity_links (source_system, platform_user_id);
  END IF;
  -- Tamper-evident money: per-account hash chain on the journal (Arch §5,
  -- CloudTrail). Legacy rows keep NULL; the chain starts at the first v2 entry.
  IF to_regclass('public.credit_transactions') IS NOT NULL THEN
    ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS prev_hash  text;
    ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS entry_hash text;
    DROP TRIGGER IF EXISTS trg_credit_txn_immutable ON credit_transactions;
    CREATE TRIGGER trg_credit_txn_immutable BEFORE UPDATE OR DELETE ON credit_transactions
      FOR EACH ROW EXECUTE FUNCTION credit_txn_immutable();
  END IF;
END $$;

-- ── Ledger chain v2 (2026-10-30): the DATABASE is the sequencer ─────────────────────────────────────────────
-- v1 chained in the application: each writer read "the newest row by created_at" and hashed onto it. That
-- forked whenever two writers read the same newest row (290 forks on one account in 2026-09), inverted when
-- created_at disagreed with commit order (~240 swaps), and covered only writers that went through
-- insertLedgerEntry (147,768 gateway rows were never hashed). v2 moves the chain into a BEFORE INSERT trigger:
-- every row, from any writer, gets the next sequence number under a per-account head lock, so a gap, a fork or an
-- unchained row is impossible without disabling the trigger -- and the verifier counts what the trigger missed.
--
-- History is SEALED, never rewritten: the first v2 entry on an account opens epoch 1, whose hash binds the last
-- v1 hash and the number of rows that came before. Material fields only (no description/metadata), so the chain
-- carries no free text and erasure never has to touch it. Fields are length-prefixed: no separator ambiguity.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS ledger_chain_epochs (
  account_id    uuid NOT NULL,
  epoch         integer NOT NULL CHECK (epoch > 0),
  opened_at     timestamp NOT NULL,
  prior_head    text,             -- the last v1 entry_hash on the account (NULL: none)
  prior_entries bigint NOT NULL CHECK (prior_entries >= 0),  -- every row before the epoch, hashed or not
  epoch_hash    text NOT NULL,
  PRIMARY KEY (account_id, epoch)
);
CREATE TABLE IF NOT EXISTS ledger_chain_heads (
  account_id uuid PRIMARY KEY,
  epoch      integer NOT NULL,
  seq        bigint NOT NULL CHECK (seq >= 0),
  head_hash  text NOT NULL,
  last_at    timestamp NOT NULL
);
-- What a verification found, appended by the checker (scripts / the hourly job). Never edited.
CREATE TABLE IF NOT EXISTS ledger_chain_attestations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  epoch      integer,
  seq        bigint,
  head_hash  text,
  kind       text NOT NULL,
  report     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(report) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ledger_chain_attestations DROP CONSTRAINT IF EXISTS ledger_chain_attestations_kind_check;
ALTER TABLE ledger_chain_attestations ADD CONSTRAINT ledger_chain_attestations_kind_check
  CHECK (kind IN ('verified', 'broken', 'history-sealed', 'resealed'));
CREATE INDEX IF NOT EXISTS idx_ledger_chain_attestations_account ON ledger_chain_attestations (account_id, created_at DESC);
-- Hourly checkpoints of every head, signed and copied OUTSIDE this database (services/ledgerChainAnchor.js).
CREATE TABLE IF NOT EXISTS ledger_chain_checkpoints (
  no         bigint PRIMARY KEY CHECK (no > 0),
  prev_hash  text,
  body_hash  text NOT NULL,
  key_id     text NOT NULL,
  object_key text NOT NULL,
  accounts   integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION ledger_lp(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE WHEN t IS NULL THEN '-1:;' ELSE octet_length(t)::text || ':' || t || ';' END
$fn$;
CREATE OR REPLACE FUNCTION ledger_ts(t timestamp) RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT to_char(t, 'YYYY-MM-DD"T"HH24:MI:SS.US')
$fn$;
CREATE OR REPLACE FUNCTION ledger_epoch_hash_v2(p_account uuid, p_epoch integer, p_prior text, p_prior_entries bigint, p_opened timestamp)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT encode(digest(convert_to(
    ledger_lp('xeno-ledger-epoch/2') || ledger_lp(p_account::text) || ledger_lp(p_epoch::text) || ledger_lp(p_prior)
    || ledger_lp(p_prior_entries::text) || ledger_lp(ledger_ts(p_opened)), 'UTF8'), 'sha256'), 'hex')
$fn$;
CREATE OR REPLACE FUNCTION ledger_entry_hash_v2(p_account uuid, p_epoch integer, p_seq bigint, p_prev text, p_user uuid,
  p_type text, p_amount bigint, p_balance bigint, p_ref_type text, p_ref_id text, p_at timestamp)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT encode(digest(convert_to(
    ledger_lp('xeno-ledger-entry/2') || ledger_lp(p_account::text) || ledger_lp(p_epoch::text) || ledger_lp(p_seq::text)
    || ledger_lp(p_prev) || ledger_lp(p_user::text) || ledger_lp(p_type) || ledger_lp(p_amount::text)
    || ledger_lp(p_balance::text) || ledger_lp(p_ref_type) || ledger_lp(p_ref_id) || ledger_lp(ledger_ts(p_at)), 'UTF8'),
    'sha256'), 'hex')
$fn$;

-- SECURITY DEFINER: a writer role (the app, the gateway, the portal) may append to the journal but holds no
-- privilege on the chain's own records; only this function moves them.
CREATE OR REPLACE FUNCTION ledger_chain_append() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  h ledger_chain_heads%ROWTYPE;
  v_prior text; v_count bigint; v_opened timestamp; v_last timestamp; v_hash text;
BEGIN
  IF NEW.account_id IS NULL THEN
    RAISE EXCEPTION 'a ledger entry names its account' USING ERRCODE = '23502';
  END IF;
  SELECT * INTO h FROM ledger_chain_heads WHERE account_id = NEW.account_id FOR UPDATE;
  IF NOT FOUND THEN
    -- First v2 entry on this account: two first writers must not both open an epoch.
    PERFORM pg_advisory_xact_lock(hashtext('xeno-ledger-epoch:' || NEW.account_id::text));
    SELECT * INTO h FROM ledger_chain_heads WHERE account_id = NEW.account_id FOR UPDATE;
    IF NOT FOUND THEN
      SELECT entry_hash INTO v_prior FROM credit_transactions
        WHERE account_id = NEW.account_id AND entry_hash IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 1;
      SELECT count(*), max(created_at)::timestamp INTO v_count, v_last FROM credit_transactions WHERE account_id = NEW.account_id;
      v_opened := clock_timestamp() AT TIME ZONE 'UTC';
      v_hash := ledger_epoch_hash_v2(NEW.account_id, 1, v_prior, v_count, v_opened);
      INSERT INTO ledger_chain_epochs (account_id, epoch, opened_at, prior_head, prior_entries, epoch_hash)
        VALUES (NEW.account_id, 1, v_opened, v_prior, v_count, v_hash);
      PERFORM set_config('xeno.ledger_append', 'on', true);
      INSERT INTO ledger_chain_heads (account_id, epoch, seq, head_hash, last_at)
        VALUES (NEW.account_id, 1, 0, v_hash, GREATEST(v_opened, COALESCE(v_last, v_opened)))
        RETURNING * INTO h;
    END IF;
  END IF;
  -- The database owns the journal's order and time: the next number under the head lock, and a time that
  -- never goes backwards (a transaction's now() is its START, not its commit order).
  NEW.created_at   := GREATEST(clock_timestamp() AT TIME ZONE 'UTC', h.last_at + interval '1 microsecond');
  NEW.chain_epoch  := h.epoch;
  NEW.chain_seq    := h.seq + 1;
  NEW.prev_hash    := h.head_hash;
  NEW.hash_version := 2;
  NEW.entry_hash   := ledger_entry_hash_v2(NEW.account_id, NEW.chain_epoch, NEW.chain_seq, NEW.prev_hash, NEW.user_id,
    NEW.type::text, NEW.amount::bigint, NEW.balance_after::bigint, NEW.reference_type::text, NEW.reference_id::text,
    NEW.created_at::timestamp);
  PERFORM set_config('xeno.ledger_append', 'on', true);
  UPDATE ledger_chain_heads SET seq = NEW.chain_seq, head_hash = NEW.entry_hash, last_at = NEW.created_at::timestamp
    WHERE account_id = NEW.account_id;
  PERFORM set_config('xeno.ledger_append', 'off', true);
  RETURN NEW;
END
$fn$;

-- A head moves only inside ledger_chain_append; epochs and attestations are never edited or removed.
CREATE OR REPLACE FUNCTION ledger_chain_heads_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' OR COALESCE(current_setting('xeno.ledger_append', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'a ledger chain head moves only by appending a ledger entry' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE OR REPLACE FUNCTION ledger_chain_record_immutable() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '23514'; END
$fn$;
-- Re-seal after a rollback window: rows written with the trigger off are outside the chain, and the verifier is right
-- to say so. A PERSON may accept them, once, with a reason: a new epoch binds the old head and the new row count, and
-- the attestation records who and why. Earlier epochs are still verified, so this can never hide an altered entry.
-- Not executable by the runtime role (database/runtime-role.js); run through scripts/ledger-reseal.mjs.
CREATE OR REPLACE FUNCTION ledger_chain_reseal(p_account uuid, p_reason text, p_actor text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  h ledger_chain_heads%ROWTYPE;
  e ledger_chain_epochs%ROWTYPE;
  v_total bigint; v_chained bigint; v_unchained bigint; v_opened timestamp; v_hash text;
BEGIN
  IF COALESCE(btrim(p_reason), '') = '' OR COALESCE(btrim(p_actor), '') = '' THEN
    RAISE EXCEPTION 'a re-seal names who and why' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO h FROM ledger_chain_heads WHERE account_id = p_account FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account % has no chain to re-seal', p_account USING ERRCODE = '23514'; END IF;
  SELECT * INTO e FROM ledger_chain_epochs WHERE account_id = p_account AND epoch = h.epoch;
  SELECT count(*) INTO v_total FROM credit_transactions WHERE account_id = p_account;
  SELECT count(*) INTO v_chained FROM credit_transactions WHERE account_id = p_account AND chain_epoch = h.epoch;
  v_unchained := v_total - e.prior_entries - v_chained;
  IF v_unchained <= 0 THEN RAISE EXCEPTION 'nothing to re-seal: every row on % is chained', p_account USING ERRCODE = '23514'; END IF;
  v_opened := clock_timestamp() AT TIME ZONE 'UTC';
  v_hash := ledger_epoch_hash_v2(p_account, h.epoch + 1, h.head_hash, v_total, v_opened);
  INSERT INTO ledger_chain_epochs (account_id, epoch, opened_at, prior_head, prior_entries, epoch_hash)
    VALUES (p_account, h.epoch + 1, v_opened, h.head_hash, v_total, v_hash);
  PERFORM set_config('xeno.ledger_append', 'on', true);
  UPDATE ledger_chain_heads SET epoch = h.epoch + 1, seq = 0, head_hash = v_hash WHERE account_id = p_account;
  PERFORM set_config('xeno.ledger_append', 'off', true);
  INSERT INTO ledger_chain_attestations (account_id, epoch, seq, head_hash, kind, report)
    VALUES (p_account, h.epoch + 1, 0, v_hash, 'resealed',
      jsonb_build_object('reason', p_reason, 'actor', p_actor, 'rows', v_unchained, 'priorEpoch', h.epoch));
  RETURN h.epoch + 1;
END
$fn$;

DROP TRIGGER IF EXISTS trg_ledger_chain_checkpoints_immutable ON ledger_chain_checkpoints;
CREATE TRIGGER trg_ledger_chain_checkpoints_immutable BEFORE UPDATE OR DELETE ON ledger_chain_checkpoints
  FOR EACH ROW EXECUTE FUNCTION ledger_chain_record_immutable();
DROP TRIGGER IF EXISTS trg_ledger_chain_heads_guard ON ledger_chain_heads;
CREATE TRIGGER trg_ledger_chain_heads_guard BEFORE INSERT OR UPDATE OR DELETE ON ledger_chain_heads
  FOR EACH ROW EXECUTE FUNCTION ledger_chain_heads_guard();
DROP TRIGGER IF EXISTS trg_ledger_chain_epochs_immutable ON ledger_chain_epochs;
CREATE TRIGGER trg_ledger_chain_epochs_immutable BEFORE UPDATE OR DELETE ON ledger_chain_epochs
  FOR EACH ROW EXECUTE FUNCTION ledger_chain_record_immutable();
DROP TRIGGER IF EXISTS trg_ledger_chain_attestations_immutable ON ledger_chain_attestations;
CREATE TRIGGER trg_ledger_chain_attestations_immutable BEFORE UPDATE OR DELETE ON ledger_chain_attestations
  FOR EACH ROW EXECUTE FUNCTION ledger_chain_record_immutable();

DO $$ BEGIN
  -- Only on a journal that names its account (every real one does; a few test fixtures carry a bare table).
  IF to_regclass('public.credit_transactions') IS NOT NULL AND EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'credit_transactions' AND column_name = 'account_id') THEN
    ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS chain_epoch  integer;
    ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS chain_seq    bigint;
    ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS hash_version smallint;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_txn_chain_seq
      ON credit_transactions (account_id, chain_epoch, chain_seq) WHERE chain_seq IS NOT NULL;
    DROP TRIGGER IF EXISTS trg_credit_txn_chain_append ON credit_transactions;
    CREATE TRIGGER trg_credit_txn_chain_append BEFORE INSERT ON credit_transactions
      FOR EACH ROW EXECUTE FUNCTION ledger_chain_append();
  END IF;
END $$;
`;

export async function migrateAccountV2(pool) {
  await pool.query(SQL);
}

// Allow running standalone.
if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
    database: process.env.DB_NAME || process.env.POSTGRES_DB,
    user: process.env.DB_USER || process.env.POSTGRES_USER,
    password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD,
  });
  migrateAccountV2(pool)
    .then(() => {
      console.log('✅ account-v2 additive migration applied');
      return pool.end();
    })
    .catch((err) => {
      console.error('❌ account-v2 migration failed:', err.message);
      process.exit(1);
    });
}
