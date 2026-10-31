-- UP
-- XENO Places City (Xenopolis handoff `Places City`, src/city/layout.js; Anti-Metaverse Law as adopted):
-- land is LEASED MONTHLY, never sold or resold. A lease holds contiguous lots of one district row in one XENO city;
-- money moves on the existing credits ledger (recordUsageV2 / reverseUsage), never here. Sponsor slots are few per
-- district (Commons 0, Civic plaza never), reviewed by a city steward, always labelled Sponsored, never shown to minors.
-- ADDITIVE ONLY: five new tables. Nothing existing is altered. DOWN drops exactly these.

CREATE TABLE IF NOT EXISTS place_city_leases (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id        TEXT NOT NULL,
  place_id       UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  district       TEXT NOT NULL CHECK (district IN ('studio','conservatory','press','workshop','market','commons')),
  monthly_micro  BIGINT NOT NULL CHECK (monthly_micro > 0),
  payer_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  state          TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','lapsing','ended')),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_through   TIMESTAMPTZ NOT NULL,
  ended_at       TIMESTAMPTZ,
  revision       BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK ((state = 'ended') = (ended_at IS NOT NULL))
);
-- one standing lease per building
CREATE UNIQUE INDEX IF NOT EXISTS place_city_leases_one_per_place ON place_city_leases (place_id) WHERE state <> 'ended';
CREATE INDEX IF NOT EXISTS place_city_leases_due ON place_city_leases (paid_through) WHERE state <> 'ended';

-- A lot is held by at most one standing lease (the partial unique index IS the "never two tenants" rule).
CREATE TABLE IF NOT EXISTS place_city_lease_lots (
  lease_id   UUID NOT NULL REFERENCES place_city_leases(id) ON DELETE CASCADE,
  city_id    TEXT NOT NULL,
  lot_id     TEXT NOT NULL CHECK (lot_id ~ '^(studio|conservatory|press|workshop|market|commons)-[01][0-3]$'),
  released_at TIMESTAMPTZ,
  PRIMARY KEY (lease_id, lot_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS place_city_lot_one_tenant ON place_city_lease_lots (city_id, lot_id) WHERE released_at IS NULL;

CREATE TABLE IF NOT EXISTS place_facades (
  place_id   UUID PRIMARY KEY REFERENCES places(id) ON DELETE CASCADE,
  material   TEXT NOT NULL CHECK (material IN ('glass','concrete','loft')),
  logo_text  TEXT NOT NULL DEFAULT '' CHECK (length(logo_text) <= 18),
  lobby_open BOOLEAN NOT NULL DEFAULT false,
  revision   BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Who may review sponsorship in a city. Granted by a platform admin (owner decision Q4 of the handoff stays open
-- for WHO; this records it). A steward never reviews their own booking (service + CHECK on bookings).
CREATE TABLE IF NOT EXISTS place_city_stewards (
  city_id    TEXT NOT NULL,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (city_id, user_id)
);

CREATE TABLE IF NOT EXISTS place_sponsor_bookings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id       TEXT NOT NULL,
  -- Commons has no slots and the Civic plaza is never a slot: only these districts, at most 3 per district.
  slot_id       TEXT NOT NULL CHECK (slot_id ~ '^slot-(studio-[01]|conservatory-0|press-[01]|workshop-[01]|market-[012])$'),
  sponsor       TEXT NOT NULL CHECK (length(btrim(sponsor)) BETWEEN 1 AND 24),
  text          TEXT NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 40),
  weeks         INTEGER NOT NULL CHECK (weeks IN (1,2,4)),
  hold_micro    BIGINT NOT NULL CHECK (hold_micro >= 0),
  charge_ref    TEXT NOT NULL,
  booked_by_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  state         TEXT NOT NULL DEFAULT 'in_review' CHECK (state IN ('in_review','live','rejected')),
  reviewed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reason        TEXT CHECK (reason IS NULL OR length(reason) <= 120),
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  starts_at     TIMESTAMPTZ,
  ends_at       TIMESTAMPTZ,
  CHECK (reviewed_by_user_id IS NULL OR reviewed_by_user_id <> booked_by_user_id),
  CHECK ((state = 'live') = (starts_at IS NOT NULL AND ends_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS place_sponsor_bookings_slot ON place_sponsor_bookings (city_id, slot_id) WHERE state <> 'rejected';

-- DOWN
DROP TABLE IF EXISTS place_sponsor_bookings;
DROP TABLE IF EXISTS place_city_stewards;
DROP TABLE IF EXISTS place_facades;
DROP TABLE IF EXISTS place_city_lease_lots;
DROP TABLE IF EXISTS place_city_leases;
