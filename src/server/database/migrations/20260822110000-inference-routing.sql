-- UP
-- ============================================================
-- Inference routing — the vault and the route.
--
-- Spec: `XENO INFERENCE ROUTING - SPEC.md` (§5). Rules for handling what lands
-- in `secret_encrypted`: `XENO CREDENTIAL HYGIENE - PLAYBOOK.md` — read it
-- before touching any code that writes to this table.
--
-- WHAT THIS SETTLES
--
-- `aiRoutes.js` has returned a hard 400 `byok_unavailable` since it was written,
-- with the comment "BYOK is owned by the XENO API, not the platform". The XENO
-- API contains zero `byok` strings, in xeno-proxy or xeno-api-proxy. Both ends
-- deferred to the other and nobody built it. This is the platform end.
--
-- ⚠️ READ BEFORE CHANGING — THE TABLE THAT LOOKS LIKE THIS ONE IS NOT THIS ONE.
--
-- `external_api_keys` already exists and its name is a trap. It is the
-- reconciliation map between keys issued by the GATEWAY (source_system =
-- 'xeno_private_api', 31 rows) and platform api_keys/billing_projects. It holds
-- key_prefix and counters — NO secret material, and no user_id at all. Putting
-- customer provider keys there would place third-party secrets in an
-- unencrypted, non-cascading, gateway-owned mapping table.
--
-- Nor does any of this belong in `user_settings.settings` (jsonb). A jsonb blob
-- has no encryption discipline, is serialised wholesale by generic request
-- loggers, and travels in database dumps as plaintext — which is exactly how the
-- 2026-07-30 "100 plaintext YouTube OAuth tokens" finding happened.
--
-- THE THREE CLASSES OF SECRET (hygiene playbook §1) — this table is class C:
--   A operator  ours              ~/.xeno-secrets, env      we rotate
--   B issued    ours, held by them  api_keys, HASHED only     we revoke
--   C entrusted THEIRS              here, secretBox-sealed    🔴 only THEY can fix a leak
--
-- Class B is hashed because we never need it back. Class C must be recoverable
-- at use time — which is precisely why every rule around it is stricter.
--
-- NEW TABLES ONLY. `XENO IDENTITY - Migration & Versioning Plan` §3/R3 forbids
-- touching a live table's columns, and `users` carries 218 rows and 33 inbound
-- foreign keys.
-- ============================================================

-- ------------------------------------------------------------
-- 1. THE VAULT
--
-- One row per third-party credential a user has entrusted to us.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_provider_credentials (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ON DELETE CASCADE is not a nicety. The 2026-08-16 purge left 9 active API
  -- keys and 24 valid refresh tokens behind for users that no longer existed,
  -- because twenty tables carry a user_id with no foreign key. An orphaned
  -- credential is a way in.
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Present and unused in v1 (spec D11). Activated with xeno-company. It is here
  -- now because R3 forbids adding it to a live table later.
  org_id           UUID NULL,

  provider         VARCHAR(32) NOT NULL
                   CHECK (provider IN ('openai','anthropic','google','openrouter','azure-openai','compatible')),

  -- User-facing name. Theirs to choose; the only way they tell two keys apart,
  -- since neither is ever displayed.
  label            VARCHAR(64) NOT NULL,

  -- secretBox envelope: 'v1.<iv-b64>.<tag-b64>.<ct-b64>'. AES-256-GCM.
  secret_encrypted TEXT NOT NULL,

  -- sha256(secret)[0:16]. The incident primitive: it makes "which of my users is
  -- affected by this provider breach" answerable WITHOUT ever having stored the
  -- thing that leaked. xeno-extension's burned-key scrubber works the same way —
  -- the 16-char constant in lib/auth-core.js IS the remover, not leftover secret.
  key_fingerprint  CHAR(16) NOT NULL,

  -- Display only. Never enough to reconstruct anything.
  key_last4        VARCHAR(8) NULL,

  -- OpenAI-compatible endpoint override (Ollama, self-hosted, Azure, xeno-rt).
  -- 🔴 A user-supplied URL is an SSRF vector into our private network — the
  -- gateway shares it with xeno-proxy on loopback :8317 and with Postgres.
  -- Guarded at CONNECT time by utils/safeEndpoint.js, not by a regex here.
  base_url         TEXT NULL,

  -- active   usable
  -- invalid  the provider rejected it; STOPS requests, never re-routes them
  -- revoked  the user withdrew it; terminal
  status           VARCHAR(16) NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','invalid','revoked')),

  -- NULL means "never proven to work". Spec D9: a credential is verified with a
  -- live provider call before it is stored active, because an unverified key
  -- fails for the first time in the middle of the user's real work.
  verified_at      TIMESTAMPTZ NULL,
  last_used_at     TIMESTAMPTZ NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The schema's own statement of "sealed at rest". Code paths multiply; a CHECK
  -- is enforced by every one of them, including the psql session someone opens
  -- at 2am. Prose invariants are not invariants.
  CONSTRAINT upc_secret_is_sealed CHECK (secret_encrypted LIKE 'v1.%')
);

-- Same key twice for the same provider is the same credential. Fingerprint, not
-- ciphertext — the IV is random, so two encryptions of one secret never match.
CREATE UNIQUE INDEX IF NOT EXISTS upc_user_provider_fingerprint_uidx
  ON user_provider_credentials (user_id, provider, key_fingerprint);

CREATE INDEX IF NOT EXISTS upc_user_idx
  ON user_provider_credentials (user_id, status);

-- ------------------------------------------------------------
-- 2. THE ROUTE
--
-- A RELATION, never a blob. Presence of the row IS the override; absence
-- INHERITS the account default. "Reset to default" is therefore a DELETE, not a
-- value someone has to remember to write correctly.
--
--   surface = '*'            the account default
--   surface = '<client_id>'  a per-product override (oauth_clients.surface)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inference_routes (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Spec D6: ONE product vocabulary across oauth_clients, api_usage_logs and
  -- here. A product that cannot name itself cannot be routed and cannot appear
  -- on the tracking page.
  surface       VARCHAR(64) NOT NULL,

  path          VARCHAR(16) NOT NULL CHECK (path IN ('premium','byok','inhouse')),

  -- managed: key in our vault, egress through our gateway, usage visible.
  -- local:   key never leaves the user's device; we see nothing, BY DESIGN.
  mode          VARCHAR(16) NOT NULL DEFAULT 'managed'
                CHECK (mode IN ('managed','local')),

  -- 🔴 RESTRICT, deliberately. Cascading a credential delete would silently
  -- re-point every product using it at premium and start spending the user's
  -- credits — the same class of failure as a silent BYOK→premium fallback, just
  -- arriving by a different route. Deleting a key in use must be refused so the
  -- UI can ask what those products should do instead.
  credential_id UUID NULL REFERENCES user_provider_credentials(id) ON DELETE RESTRICT,

  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, surface),

  -- Makes "route to my own key, but there is no key" UNREPRESENTABLE rather than
  -- a runtime error discovered mid-request. Same technique that fixed xeno-use's
  -- raw container mount strings.
  CONSTRAINT ir_byok_needs_credential CHECK (
    path <> 'byok' OR mode = 'local' OR credential_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS ir_credential_idx
  ON inference_routes (credential_id) WHERE credential_id IS NOT NULL;

-- DOWN
DROP TABLE IF EXISTS inference_routes;
DROP TABLE IF EXISTS user_provider_credentials;
