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

-- Identity-by-(provider,subject): one (surface → canonical user) link, idempotent
-- upsert target for sign-in. (Arch §2.1 / §0.4 — the "from where" join, not email.)
CREATE UNIQUE INDEX IF NOT EXISTS uq_eil_source_platform
  ON external_identity_links (source_system, platform_user_id);
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
