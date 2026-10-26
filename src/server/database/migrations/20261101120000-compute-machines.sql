-- XENO Compute (codename Machina) — the platform half: machines, their metered time, and caps.
--
-- Owner, 2026-10-26: "yes we'll lock this in" (XENO Compute, unit = machine) and "Two pools (Recommended)":
-- credits pay for what you USE (AI and machine time), Storage holds what you KEEP. Spec: xeno-compute/SPEC.md §2a.
--
-- The platform owns the record, the money and the screens. Placement and start/stop of the real machine belong
-- to xeno-compute (called through services/computeBackend.js); isolation belongs to xeno-box. Nothing here runs one.
--
-- Money rules held by the database, not only the service:
--   * a size with no rate cannot be started (compute_rates.rate_micro_per_hour IS NULL = "not priced yet") — prices are
--     the owner's decision and are NOT invented here; every size ships unpriced
--   * a running machine has exactly one open session, and an open session belongs to a running machine
--   * machine state moves only along creating → running ⇄ stopped → deleted, plus failed
--   * a session's rate is PINNED when it opens, so a price change never re-prices time already running

CREATE TABLE compute_rates (
  size              text PRIMARY KEY CHECK (size ~ '^[a-z][a-z0-9-]{0,31}$'),
  rank              int NOT NULL UNIQUE,                 -- small → large; "max size" caps compare ranks
  vcpus             int NOT NULL CHECK (vcpus > 0),
  memory_gb         int NOT NULL CHECK (memory_gb > 0),
  disk_gb           int NOT NULL CHECK (disk_gb > 0),
  -- micro-credits per hour of running time. NULL = this size is not priced yet and cannot be started.
  rate_micro_per_hour bigint CHECK (rate_micro_per_hour IS NULL OR rate_micro_per_hour > 0),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES users(id) ON DELETE SET NULL
);

-- The sizes exist so a machine can be described; none is priced (owner decision pending, SPEC §9).
INSERT INTO compute_rates (size, rank, vcpus, memory_gb, disk_gb) VALUES
  ('small', 1, 2, 4, 20),
  ('medium', 2, 4, 16, 50),
  ('large', 3, 8, 32, 100);

CREATE TABLE compute_machines (
  id                text PRIMARY KEY CHECK (id ~ '^mch_[0-9a-f]{32}$'),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- the agent the machine works for (an agent_identities user), or NULL for a person's own machine
  agent_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  name              text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  size              text NOT NULL REFERENCES compute_rates(size) ON DELETE RESTRICT,
  purpose           text CHECK (purpose IS NULL OR char_length(purpose) <= 500),
  image             text CHECK (image IS NULL OR char_length(image) <= 200),
  state             text NOT NULL DEFAULT 'creating' CHECK (state IN ('creating', 'running', 'stopped', 'deleted', 'failed')),
  failure           text,
  backend_ref       text,                                -- xeno-compute's own id for the machine
  -- set when a running machine's next time segment could not be funded: it keeps running (a cap or an empty
  -- wallet never stops work silently, SPEC §2a) and the workspace is told; cleared when funding resumes or it stops
  unfunded_since    timestamptz,
  idempotency_key   text CHECK (idempotency_key IS NULL OR char_length(idempotency_key) <= 100),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT compute_machine_deleted_has_time CHECK ((state = 'deleted') = (deleted_at IS NOT NULL))
);
CREATE UNIQUE INDEX compute_machines_idempotency ON compute_machines (workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX compute_machines_workspace ON compute_machines (workspace_id) WHERE state <> 'deleted';
CREATE INDEX compute_machines_agent ON compute_machines (agent_user_id) WHERE state <> 'deleted' AND agent_user_id IS NOT NULL;

-- One row per stretch of running time. Billed as a sequence of ledger holds (one per segment), settled on time used.
CREATE TABLE compute_sessions (
  id                bigserial PRIMARY KEY,
  machine_id        text NOT NULL REFERENCES compute_machines(id) ON DELETE RESTRICT,
  payer_id          uuid NOT NULL,                       -- the credit_accounts.user_id billed (a person, or a pooled workspace)
  started_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  rate_micro_per_hour bigint NOT NULL CHECK (rate_micro_per_hour > 0),
  started_at        timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz,
  -- the segment currently reserved on the ledger
  hold_id           text,
  segment_started_at timestamptz NOT NULL DEFAULT now(),
  segment_seq       int NOT NULL DEFAULT 1,
  settled_micro     bigint NOT NULL DEFAULT 0 CHECK (settled_micro >= 0),
  CONSTRAINT compute_session_ends_after_start CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX compute_sessions_one_open ON compute_sessions (machine_id) WHERE ended_at IS NULL;
CREATE INDEX compute_sessions_payer ON compute_sessions (payer_id, started_at);

-- Caps (SPEC §2a; pricing ledger §8b D7: caps are SET BY PEOPLE). A cap refuses a new start or a larger size;
-- it never stops or deletes running work.
CREATE TABLE compute_caps (
  id                bigserial PRIMARY KEY,
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scope_kind        text NOT NULL CHECK (scope_kind IN ('workspace', 'division', 'agent')),
  scope_id          text NOT NULL,                       -- the workspace id, a division id, or an agent user id
  max_machines      int CHECK (max_machines IS NULL OR max_machines >= 0),
  max_size          text REFERENCES compute_rates(size) ON DELETE RESTRICT,
  monthly_credit_cap_micro bigint CHECK (monthly_credit_cap_micro IS NULL OR monthly_credit_cap_micro >= 0),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT compute_cap_workspace_scope CHECK (scope_kind <> 'workspace' OR scope_id = workspace_id::text),
  UNIQUE (workspace_id, scope_kind, scope_id)
);

-- Machine state may only move along the documented edges.
CREATE FUNCTION compute_machine_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = OLD.state THEN RETURN NEW; END IF;
  IF NOT (
       (OLD.state = 'creating' AND NEW.state IN ('stopped', 'running', 'failed'))
    OR (OLD.state = 'running'  AND NEW.state IN ('stopped', 'failed'))
    OR (OLD.state = 'stopped'  AND NEW.state IN ('running', 'deleted', 'failed'))
    OR (OLD.state = 'failed'   AND NEW.state IN ('deleted', 'stopped'))
  ) THEN
    RAISE EXCEPTION 'compute machine % cannot move from % to %', OLD.id, OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  -- running requires an open session; leaving running requires that it was closed first
  IF NEW.state = 'running' AND NOT EXISTS (SELECT 1 FROM compute_sessions WHERE machine_id = NEW.id AND ended_at IS NULL) THEN
    RAISE EXCEPTION 'compute machine % cannot run without an open billing session', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state = 'running' AND EXISTS (SELECT 1 FROM compute_sessions WHERE machine_id = NEW.id AND ended_at IS NULL) THEN
    RAISE EXCEPTION 'compute machine % must close its billing session before leaving running', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER compute_machine_transition BEFORE UPDATE OF state ON compute_machines
  FOR EACH ROW EXECUTE FUNCTION compute_machine_transition();

-- A session may only open on a machine that is about to run or is running, and never on an unpriced size.
CREATE FUNCTION compute_session_open() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text; rate bigint;
BEGIN
  SELECT m.state, r.rate_micro_per_hour INTO st, rate FROM compute_machines m JOIN compute_rates r ON r.size = m.size WHERE m.id = NEW.machine_id;
  IF st NOT IN ('creating', 'stopped', 'running') THEN
    RAISE EXCEPTION 'cannot bill time on a % machine', st USING ERRCODE = 'check_violation';
  END IF;
  IF rate IS NULL THEN
    RAISE EXCEPTION 'size of machine % has no price yet', NEW.machine_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER compute_session_open BEFORE INSERT ON compute_sessions
  FOR EACH ROW EXECUTE FUNCTION compute_session_open();

-- The machine's timeline: every change a person should be able to see later (started, billed, could not be funded,
-- stopped and why). This is how "never stops work silently" is kept: a stop for money is an event with its reason.
CREATE TABLE compute_events (
  id                bigserial PRIMARY KEY,
  machine_id        text NOT NULL REFERENCES compute_machines(id) ON DELETE RESTRICT,
  kind              text NOT NULL CHECK (kind IN ('created', 'started', 'stopped', 'deleted', 'failed', 'billed', 'unfunded', 'funded', 'capped')),
  actor_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX compute_events_machine ON compute_events (machine_id, created_at);
