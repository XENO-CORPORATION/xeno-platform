-- UP
-- XENO Polis (Xenopolis handoff polis/geo.js): a region that opens ON DEMAND opens when enough people pledge for it;
-- a city that is not open yet keeps a waitlist. Each row is one person's own signal — counts are these rows, never
-- seeded numbers. ADDITIVE ONLY: two new tables. DOWN drops exactly these.
CREATE TABLE IF NOT EXISTS place_world_pledges (
  region_id  TEXT NOT NULL CHECK (region_id ~ '^[a-z]{2}-[a-z]{2,8}$'),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (region_id, user_id)
);
CREATE TABLE IF NOT EXISTS place_world_waitlist (
  city_id    TEXT NOT NULL CHECK (city_id ~ '^[a-z]{2,16}$'),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (city_id, user_id)
);

-- DOWN
DROP TABLE IF EXISTS place_world_waitlist;
DROP TABLE IF EXISTS place_world_pledges;
