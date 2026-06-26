-- UP
-- ============================================================
-- XENO Marketplace — unified content-typed, monetized, two-sided marketplace
-- SPEC: "XENO MARKETPLACE - SPEC.md" §7 (data model). Decisions D1–D6.
--
-- Reuse map:
--   - Identity foundation: users(id), users.role  (existing)
--   - Metering substrate: users.credits + credit_usage  (existing credits ledger)
--   - Artifact delivery: R2 signed URLs via cdnOptimization.generateSignedUrl  (existing)
--
-- This migration creates the 11 marketplace tables from §7. First-party apps and
-- the local-model catalog are seeded as `official` listings by the marketplace
-- seed script (database/seeds/marketplace-seed.js), not inline here, so the seed
-- stays idempotent and re-runnable.
-- ============================================================

-- ------------------------------------------------------------
-- developers — a user who can publish to the marketplace.
-- trust_tier gates what `kind`s may be published (D1).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_developers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name       VARCHAR(120) NOT NULL,
  slug               VARCHAR(120) NOT NULL,
  bio                TEXT,
  website            TEXT,
  trust_tier         VARCHAR(20) NOT NULL DEFAULT 'community'
                     CHECK (trust_tier IN ('community', 'verified', 'official')),
  verified_at        TIMESTAMPTZ,
  payout_account_id  VARCHAR(255),          -- Stripe Connect account id (set at KYC time)
  status             VARCHAR(20) NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'suspended', 'closed')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mkt_developers_slug ON marketplace_developers(slug);
-- A user account maps to at most one developer profile.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mkt_developers_user ON marketplace_developers(user_id);
CREATE INDEX IF NOT EXISTS idx_mkt_developers_trust ON marketplace_developers(trust_tier);

-- ------------------------------------------------------------
-- developer_api_keys — scoped publishing keys (CI / programmatic publish).
-- Only the hash is stored; the plaintext key is shown once at creation.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_developer_api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id  UUID NOT NULL REFERENCES marketplace_developers(id) ON DELETE CASCADE,
  name          VARCHAR(120) NOT NULL,
  key_prefix    VARCHAR(16) NOT NULL,        -- non-secret prefix for display/lookup
  key_hash      VARCHAR(128) NOT NULL,       -- sha256 hex of full key
  scopes        TEXT[] NOT NULL DEFAULT '{}',
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mkt_devkeys_hash ON marketplace_developer_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_mkt_devkeys_developer ON marketplace_developer_api_keys(developer_id);
CREATE INDEX IF NOT EXISTS idx_mkt_devkeys_scopes ON marketplace_developer_api_keys USING gin(scopes);

-- ------------------------------------------------------------
-- listings — one catalog entry. `kind` taxonomy from SPEC §2.
-- developer_id is NULL for first-party `official` seed rows (no dev account).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_listings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             VARCHAR(160) NOT NULL,
  kind             VARCHAR(24) NOT NULL
                   CHECK (kind IN ('app-native','app-sandboxed','panel','plugin','mcp','model','mind','swarm')),
  developer_id     UUID REFERENCES marketplace_developers(id) ON DELETE SET NULL,
  title            VARCHAR(200) NOT NULL,
  summary          VARCHAR(500),
  description      TEXT,
  category         VARCHAR(80),
  trust_tier       VARCHAR(20) NOT NULL DEFAULT 'community'
                   CHECK (trust_tier IN ('community', 'verified', 'official')),
  icon_url         TEXT,
  screenshots      JSONB NOT NULL DEFAULT '[]'::jsonb,
  homepage_url     TEXT,
  license          VARCHAR(120),
  status           VARCHAR(20) NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','in_review','published','suspended')),
  current_version  VARCHAR(40),
  is_first_party   BOOLEAN NOT NULL DEFAULT false,
  install_meta     JSONB NOT NULL DEFAULT '{}'::jsonb,   -- kind-specific (e.g. native install dir / exe)
  rating_avg       NUMERIC(3,2) NOT NULL DEFAULT 0,
  rating_count     INTEGER NOT NULL DEFAULT 0,
  install_count    BIGINT NOT NULL DEFAULT 0,
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mkt_listings_slug ON marketplace_listings(slug);
CREATE INDEX IF NOT EXISTS idx_mkt_listings_kind ON marketplace_listings(kind);
CREATE INDEX IF NOT EXISTS idx_mkt_listings_trust ON marketplace_listings(trust_tier);
CREATE INDEX IF NOT EXISTS idx_mkt_listings_developer ON marketplace_listings(developer_id);
CREATE INDEX IF NOT EXISTS idx_mkt_listings_status ON marketplace_listings(status);
CREATE INDEX IF NOT EXISTS idx_mkt_listings_category ON marketplace_listings(category);
CREATE INDEX IF NOT EXISTS idx_mkt_listings_screenshots ON marketplace_listings USING gin(screenshots);

-- ------------------------------------------------------------
-- listing_versions — immutable, signed artifact records per version.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_listing_versions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id             UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  version                VARCHAR(40) NOT NULL,
  artifact_r2_key        TEXT,                 -- R2 object key; NULL for descriptor-only kinds (mcp)
  artifact_url           TEXT,                 -- public/non-gated URL when not entitlement-gated (e.g. official native)
  artifact_sha256        VARCHAR(64),
  artifact_size_bytes    BIGINT,
  ed25519_sig            TEXT,                 -- base64 signature over the sha256
  ed25519_pubkey         TEXT,                 -- base64 public key used to sign
  release_notes          TEXT,
  declared_capabilities  JSONB NOT NULL DEFAULT '[]'::jsonb,  -- xeno-use verbs / MCP / panels (preflightTrust)
  manifest               JSONB NOT NULL DEFAULT '{}'::jsonb,  -- parsed artifact manifest
  has_native_binary      BOOLEAN NOT NULL DEFAULT false,      -- D1 server-side enforcement input
  published_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mkt_versions_listing_version
  ON marketplace_listing_versions(listing_id, version);
CREATE INDEX IF NOT EXISTS idx_mkt_versions_listing ON marketplace_listing_versions(listing_id);
CREATE INDEX IF NOT EXISTS idx_mkt_versions_caps
  ON marketplace_listing_versions USING gin(declared_capabilities);

-- ------------------------------------------------------------
-- listing_pricing — a listing may offer one or more pricing models (D5).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_listing_pricing (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id     UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  model          VARCHAR(20) NOT NULL
                 CHECK (model IN ('free','one_time','subscription','pay_per_use','rental')),
  price_credits  INTEGER NOT NULL DEFAULT 0,   -- canonical currency = credits
  price_usd      NUMERIC(10,2),                -- informational / display
  period         VARCHAR(20)                   -- 'month' | 'year' for subscription; rental window for rental
                 CHECK (period IS NULL OR period IN ('day','week','month','year')),
  meter_unit     VARCHAR(40),                  -- 'invocation' | 'token' | '1k_tokens' for pay_per_use
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mkt_pricing_listing ON marketplace_listing_pricing(listing_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mkt_pricing_listing_model
  ON marketplace_listing_pricing(listing_id, model);

-- ------------------------------------------------------------
-- entitlements — a buyer↔listing grant. Gates download / invocation.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_entitlements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id   UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  kind         VARCHAR(20) NOT NULL
               CHECK (kind IN ('owned','subscribed','rental')),
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ,                    -- NULL = perpetual (owned); set for subscribed/rental
  status       VARCHAR(20) NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','expired','revoked')),
  source_txn_id UUID,                          -- last transaction that granted/renewed this
  meta         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One active entitlement row per (user, listing) — renewals update in place.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mkt_entitlements_user_listing
  ON marketplace_entitlements(user_id, listing_id);
CREATE INDEX IF NOT EXISTS idx_mkt_entitlements_user ON marketplace_entitlements(user_id);
CREATE INDEX IF NOT EXISTS idx_mkt_entitlements_listing ON marketplace_entitlements(listing_id);
CREATE INDEX IF NOT EXISTS idx_mkt_entitlements_status ON marketplace_entitlements(status);

-- ------------------------------------------------------------
-- marketplace_transactions — money/credit movement record. Links to credits ledger
-- (the credit_usage row written alongside carries txn id in metadata).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id    UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  developer_id  UUID REFERENCES marketplace_developers(id) ON DELETE SET NULL,
  type          VARCHAR(20) NOT NULL
                CHECK (type IN ('purchase','subscribe','renew','rent','usage','refund')),
  gross         INTEGER NOT NULL DEFAULT 0,    -- credits charged (negative for refund)
  platform_fee  INTEGER NOT NULL DEFAULT 0,
  creator_net   INTEGER NOT NULL DEFAULT 0,
  currency      VARCHAR(10) NOT NULL DEFAULT 'credits'
                CHECK (currency IN ('credits')),
  status        VARCHAR(20) NOT NULL DEFAULT 'completed'
                CHECK (status IN ('completed','reversed','failed')),
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mkt_txns_user ON marketplace_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_mkt_txns_listing ON marketplace_transactions(listing_id);
CREATE INDEX IF NOT EXISTS idx_mkt_txns_developer ON marketplace_transactions(developer_id);
CREATE INDEX IF NOT EXISTS idx_mkt_txns_type ON marketplace_transactions(type);
CREATE INDEX IF NOT EXISTS idx_mkt_txns_created ON marketplace_transactions(created_at);

-- ------------------------------------------------------------
-- creator_earnings — per-developer accrual of net credits (cash-out source).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_creator_earnings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id    UUID NOT NULL REFERENCES marketplace_developers(id) ON DELETE CASCADE,
  transaction_id  UUID REFERENCES marketplace_transactions(id) ON DELETE SET NULL,
  amount_credits  INTEGER NOT NULL DEFAULT 0,  -- positive = accrual, negative = payout/clawback
  state           VARCHAR(20) NOT NULL DEFAULT 'available'
                  CHECK (state IN ('pending','available','paid_out','reversed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mkt_earnings_developer ON marketplace_creator_earnings(developer_id);
CREATE INDEX IF NOT EXISTS idx_mkt_earnings_state ON marketplace_creator_earnings(state);

-- ------------------------------------------------------------
-- payouts — Stripe-Connect-class cash-out records (KYC/tax status). D6.
-- The actual Stripe transfer is performed by a payoutsProvider seam; v1
-- records the request and leaves provider state at 'not_implemented'.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_payouts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id       UUID NOT NULL REFERENCES marketplace_developers(id) ON DELETE CASCADE,
  amount_credits     INTEGER NOT NULL,
  amount_usd         NUMERIC(10,2),
  state              VARCHAR(24) NOT NULL DEFAULT 'requested'
                     CHECK (state IN ('requested','processing','paid','failed','not_implemented','cancelled')),
  provider           VARCHAR(40) NOT NULL DEFAULT 'stripe_connect',
  provider_payout_id VARCHAR(255),
  kyc_status         VARCHAR(20) NOT NULL DEFAULT 'unverified'
                     CHECK (kyc_status IN ('unverified','pending','verified','rejected')),
  failure_reason     TEXT,
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mkt_payouts_developer ON marketplace_payouts(developer_id);
CREATE INDEX IF NOT EXISTS idx_mkt_payouts_state ON marketplace_payouts(state);

-- ------------------------------------------------------------
-- app_reviews — one rating+text per (listing, user).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_app_reviews (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id   UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating       SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title        VARCHAR(200),
  text         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mkt_reviews_listing_user
  ON marketplace_app_reviews(listing_id, user_id);
CREATE INDEX IF NOT EXISTS idx_mkt_reviews_listing ON marketplace_app_reviews(listing_id);

-- ------------------------------------------------------------
-- submissions — review-queue records for the publish pipeline (SPEC §6).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_submissions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id          UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  listing_version_id  UUID NOT NULL REFERENCES marketplace_listing_versions(id) ON DELETE CASCADE,
  developer_id        UUID REFERENCES marketplace_developers(id) ON DELETE SET NULL,
  state               VARCHAR(20) NOT NULL DEFAULT 'submitted'
                      CHECK (state IN ('submitted','checks_failed','in_review','approved','rejected')),
  checks              JSONB NOT NULL DEFAULT '{}'::jsonb,  -- automated-check results (SPEC §6)
  reviewer            UUID REFERENCES users(id) ON DELETE SET NULL,
  notes               TEXT,
  submitted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mkt_submissions_state ON marketplace_submissions(state);
CREATE INDEX IF NOT EXISTS idx_mkt_submissions_listing ON marketplace_submissions(listing_id);
CREATE INDEX IF NOT EXISTS idx_mkt_submissions_version ON marketplace_submissions(listing_version_id);

-- DOWN
DROP TABLE IF EXISTS marketplace_submissions;
DROP TABLE IF EXISTS marketplace_app_reviews;
DROP TABLE IF EXISTS marketplace_payouts;
DROP TABLE IF EXISTS marketplace_creator_earnings;
DROP TABLE IF EXISTS marketplace_transactions;
DROP TABLE IF EXISTS marketplace_entitlements;
DROP TABLE IF EXISTS marketplace_listing_pricing;
DROP TABLE IF EXISTS marketplace_listing_versions;
DROP TABLE IF EXISTS marketplace_listings;
DROP TABLE IF EXISTS marketplace_developer_api_keys;
DROP TABLE IF EXISTS marketplace_developers;
