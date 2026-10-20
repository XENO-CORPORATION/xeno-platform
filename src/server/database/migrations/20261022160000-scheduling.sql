-- UP
-- Corpo › Scheduling (services/scheduling.js): availability, booking pages, bookings, calendar events, ICS feeds.
-- Owned by the WORKSPACE (XENO-WORKFORCE-01 §8.11). A booking is held twice: the service takes a per-host lock and
-- checks overlap, and the trigger below refuses an overlapping confirmed booking whatever path wrote it.
-- Time off is NOT here: it is workforce_time_off (People, 20261022150000), read as-is. Working hours default to
-- workforce_employee_profiles.working_hours; scheduling_availability is the person's booking-hours override.
-- ADDITIVE ONLY: new tables, functions and triggers. DOWN drops exactly them.

CREATE TABLE IF NOT EXISTS scheduling_availability (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  timezone     TEXT NOT NULL DEFAULT 'UTC',
  -- {"1":[["09:00","17:00"]], ...}: ISO weekday (1 = Monday … 7 = Sunday) → local intervals
  weekly       JSONB NOT NULL DEFAULT '{"1":[["09:00","17:00"]],"2":[["09:00","17:00"]],"3":[["09:00","17:00"]],"4":[["09:00","17:00"]],"5":[["09:00","17:00"]]}'::jsonb,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS scheduling_pages (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  host_user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug               TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  title              TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description        TEXT NOT NULL DEFAULT '',
  duration_minutes   INTEGER NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  buffer_minutes     INTEGER NOT NULL DEFAULT 0 CHECK (buffer_minutes BETWEEN 0 AND 240),
  min_notice_minutes INTEGER NOT NULL DEFAULT 60 CHECK (min_notice_minutes BETWEEN 0 AND 43200),
  horizon_days       INTEGER NOT NULL DEFAULT 30 CHECK (horizon_days BETWEEN 1 AND 365),
  reminder_minutes   INTEGER NOT NULL DEFAULT 60 CHECK (reminder_minutes BETWEEN 0 AND 10080),
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  -- a public link is a person's act: an agent never creates one (held by the service and by the trigger below)
  created_by         UUID NOT NULL REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS scheduling_pages_ws ON scheduling_pages (workspace_id);

CREATE OR REPLACE FUNCTION scheduling_page_human_creator() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM agent_identities WHERE user_id = NEW.created_by) THEN
    RAISE EXCEPTION 'scheduling: an agent cannot create a public booking page' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS scheduling_page_human_creator ON scheduling_pages;
CREATE TRIGGER scheduling_page_human_creator BEFORE INSERT OR UPDATE OF created_by ON scheduling_pages
  FOR EACH ROW EXECUTE FUNCTION scheduling_page_human_creator();

CREATE TABLE IF NOT EXISTS scheduling_bookings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id           UUID NOT NULL REFERENCES scheduling_pages(id) ON DELETE CASCADE,
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  host_user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at         TIMESTAMPTZ NOT NULL,
  ends_at           TIMESTAMPTZ NOT NULL,
  guest_name        TEXT NOT NULL CHECK (char_length(guest_name) BETWEEN 1 AND 200),
  guest_email       TEXT NOT NULL CHECK (char_length(guest_email) BETWEEN 3 AND 320),
  note              TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  manage_token_hash TEXT NOT NULL UNIQUE,
  rescheduled_from  UUID REFERENCES scheduling_bookings(id),
  reminder_sent_at  TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,
  cancelled_by      TEXT CHECK (cancelled_by IN ('guest', 'host')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS scheduling_bookings_host ON scheduling_bookings (host_user_id, starts_at) WHERE status = 'confirmed';

CREATE OR REPLACE FUNCTION scheduling_booking_no_overlap() RETURNS trigger AS $$
BEGIN
  IF NEW.status <> 'confirmed' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('scheduling:' || NEW.host_user_id::text));
  IF EXISTS (SELECT 1 FROM scheduling_bookings b WHERE b.host_user_id = NEW.host_user_id AND b.status = 'confirmed'
             AND b.id <> NEW.id AND b.starts_at < NEW.ends_at AND b.ends_at > NEW.starts_at) THEN
    RAISE EXCEPTION 'scheduling: the host is already booked at that time' USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS scheduling_booking_no_overlap ON scheduling_bookings;
CREATE TRIGGER scheduling_booking_no_overlap BEFORE INSERT OR UPDATE OF starts_at, ends_at, status ON scheduling_bookings
  FOR EACH ROW EXECUTE FUNCTION scheduling_booking_no_overlap();

-- The person's calendar on the platform. A booking makes one event; cancelling the booking cancels it.
CREATE TABLE IF NOT EXISTS calendar_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ NOT NULL,
  source       TEXT NOT NULL DEFAULT 'booking' CHECK (source IN ('booking', 'manual')),
  booking_id   UUID UNIQUE REFERENCES scheduling_bookings(id) ON DELETE CASCADE,
  cancelled    BOOLEAN NOT NULL DEFAULT FALSE,
  sequence     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS calendar_events_user ON calendar_events (user_id, starts_at);

-- A private ICS feed URL per person per workspace. Only the hash is stored; rotating replaces it.
CREATE TABLE IF NOT EXISTS calendar_feed_tokens (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);

-- DOWN
DROP TABLE IF EXISTS calendar_feed_tokens;
DROP TABLE IF EXISTS calendar_events;
DROP TRIGGER IF EXISTS scheduling_booking_no_overlap ON scheduling_bookings;
DROP FUNCTION IF EXISTS scheduling_booking_no_overlap();
DROP TABLE IF EXISTS scheduling_bookings;
DROP TRIGGER IF EXISTS scheduling_page_human_creator ON scheduling_pages;
DROP FUNCTION IF EXISTS scheduling_page_human_creator();
DROP TABLE IF EXISTS scheduling_pages;
DROP TABLE IF EXISTS scheduling_availability;
