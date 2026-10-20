-- UP
-- Per-person site access codes (owner, 2026-10-20: "access codes we can give to investors"). Each code opens the gated
-- pages (scope 'pages') or the pages AND account creation while registration is closed (scope 'account'). Only a
-- SHA-256 of the code is stored; the code itself is shown once, to the admin who made it. Revoking or expiring a code
-- invalidates every gate cookie issued from it, because the page check re-reads this row on every request.
CREATE TABLE IF NOT EXISTS site_access_codes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label             TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 160),
  code_hash         TEXT NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  scope             TEXT NOT NULL DEFAULT 'pages' CHECK (scope IN ('pages', 'account')),
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,
  max_uses          INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  uses              INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
  revoked_at        TIMESTAMPTZ,
  revoked_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  last_used_at      TIMESTAMPTZ,
  last_used_country TEXT CHECK (last_used_country IS NULL OR last_used_country ~ '^[A-Z0-9]{2}$'),
  CHECK (expires_at > created_at),
  CHECK (max_uses IS NULL OR uses <= max_uses)
);

-- The audit: created, redeemed (country only — never a full address), revoked, and which account used a code.
CREATE TABLE IF NOT EXISTS site_access_code_events (
  id         BIGSERIAL PRIMARY KEY,
  code_id    UUID NOT NULL REFERENCES site_access_codes(id) ON DELETE CASCADE,
  event      TEXT NOT NULL CHECK (event IN ('created', 'redeemed', 'revoked', 'used_by_account')),
  actor_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  country    TEXT CHECK (country IS NULL OR country ~ '^[A-Z0-9]{2}$'),
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_access_code_events_code ON site_access_code_events (code_id, at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS site_access_code_events_account_once ON site_access_code_events (code_id, actor_id) WHERE event = 'used_by_account';

-- DOWN
DROP TABLE IF EXISTS site_access_code_events;
DROP TABLE IF EXISTS site_access_codes;
