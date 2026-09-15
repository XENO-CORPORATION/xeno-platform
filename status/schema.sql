-- XENO Status — D1 schema. Idempotent: safe to apply on every deploy.

-- The current state of each component, and the counters that keep one bad probe from
-- opening an incident (flap protection lives in worker.mjs `nextState`).
CREATE TABLE IF NOT EXISTS component_state (
  component        TEXT PRIMARY KEY,
  status           TEXT    NOT NULL,            -- 'operational' | 'down'
  since            INTEGER NOT NULL,            -- ms epoch of the last transition
  consecutive_fail INTEGER NOT NULL DEFAULT 0,
  consecutive_ok   INTEGER NOT NULL DEFAULT 0,
  last_checked     INTEGER,
  last_latency_ms  INTEGER,
  last_error       TEXT
);

-- Raw probe results. Kept briefly, for debugging a specific incident; the page never reads them.
CREATE TABLE IF NOT EXISTS checks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  component   TEXT    NOT NULL,
  ts          INTEGER NOT NULL,
  ok          INTEGER NOT NULL,
  http_status INTEGER,
  latency_ms  INTEGER,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_checks_ts ON checks (ts);

-- One row per component per UTC day. This is what the uptime bars read, so a page view is a
-- bounded read of at most (components x 90) rows rather than a scan of every probe.
CREATE TABLE IF NOT EXISTS daily (
  component TEXT    NOT NULL,
  day       TEXT    NOT NULL,                  -- 'YYYY-MM-DD', UTC
  total     INTEGER NOT NULL,
  ok        INTEGER NOT NULL,
  PRIMARY KEY (component, day)
);

-- Incidents are opened and resolved by state transitions, never typed in by hand.
--
-- The two *_alert_sent flags make this table the alert OUTBOX. An alert is marked sent only
-- after delivery succeeds, and every run retries what is still unsent — so a failed email is
-- delayed, never lost. Without them, an incident whose alert failed would be recorded as
-- open, the state would already read "down", and no later run would ever try again.
CREATE TABLE IF NOT EXISTS incidents (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  component           TEXT    NOT NULL,
  started_at          INTEGER NOT NULL,
  resolved_at         INTEGER,
  summary             TEXT    NOT NULL,
  opened_alert_sent   INTEGER NOT NULL DEFAULT 0,
  resolved_alert_sent INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_incidents_outbox ON incidents (opened_alert_sent, resolved_alert_sent);
CREATE INDEX IF NOT EXISTS idx_incidents_open ON incidents (component, resolved_at);
CREATE INDEX IF NOT EXISTS idx_incidents_started ON incidents (started_at);
