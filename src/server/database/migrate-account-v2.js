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
