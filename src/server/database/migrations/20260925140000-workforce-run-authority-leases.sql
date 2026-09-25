-- UP
-- XENO-WORKFORCE-01 RUN-03, NFR-06, NFR-10 -- live authority for an ADMITTED run, and the bounded
-- lease that carries it while the runtime is disconnected.
--
--   RUN-03: "Pins preserve reproducibility; live revocation still overrides pinned grants before each
--            privileged call and new provider dispatch. On lost authority, checkpoint/stop according to
--            the bounded lease policy; never spend indefinitely offline."
--   NFR-06: "Connected revocation blocks the next privileged operation; disconnected execution uses
--            explicit short-lived admission leases, maximum 60 seconds, and then checkpoints/blocks.
--            Any already-dispatched noncancellable operation is visible until actual settlement."
--   NFR-10: "The 60-second lease uses signed/validated expiry and a monotonic elapsed-time bound from
--            receipt, with conservative clock-skew allowance. It cannot restart from zero after process
--            restart, wall-clock rollback or reconnect. Without reliable remaining-validity proof,
--            require online re-admission. This bounds new authorization, not completion time of
--            already-dispatched noncancellable work."
--
-- An admission (20260925130000) is the decision that a run may START. This file holds what happens
-- AFTER: every privileged call and every new provider dispatch asks the platform again, and the answer
-- is re-derived from the live rows the admission named -- never from the admission's own snapshot.
--
-- TWO TABLES, ONE PER FACT:
--   workforce_run_revocations  a durable decision that an admission may authorize NOTHING further.
--                              One per admission, immutable. It is the "durable revocation epoch" RUN-10
--                              names: once written, every lease issued before it is fenced, whatever its
--                              own clock says.
--   workforce_run_leases       every lease the platform ever issued, with a per-admission SEQUENCE. The
--                              sequence is the monotonic fence: a lease whose sequence is below the
--                              admission's latest is superseded, so a runtime replaying an old lease after
--                              a restart or reconnect is not holding current authority. The expiry is at
--                              most 60 seconds after issue BY CONSTRUCTION, not by convention.
--
-- WHAT A LEASE IS NOT: a financial commitment. Revoking authority does not release a hold or
-- cancel dispatched work -- FUND-09 already forbids releasing a reservation because a lease expired,
-- and NFR-06's last sentence says dispatched noncancellable work stays visible until it settles.

CREATE TABLE workforce_run_revocations (
  admission_id UUID PRIMARY KEY REFERENCES workforce_run_admissions(id) ON DELETE RESTRICT,
  -- WHY, as a closed vocabulary so a client can act on it without parsing prose -- and WHO, when a
  -- person decided. `authority_lost` is the platform's own finding that a live term no longer holds,
  -- so it names nobody: attributing it to the actor who happened to ask would be a false record.
  reason TEXT NOT NULL CHECK (reason IN ('stopped_by_actor','stopped_by_target','authority_lost')),
  revoked_by_user_id UUID,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT workforce_run_revocation_attribution CHECK ((reason = 'authority_lost') = (revoked_by_user_id IS NULL))
);
COMMENT ON TABLE workforce_run_revocations IS
  'RUN-03/RUN-10: a durable decision that an admitted run may authorize nothing further. Fences every earlier lease. Immutable.';

CREATE TABLE workforce_run_leases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id UUID NOT NULL REFERENCES workforce_run_admissions(id) ON DELETE RESTRICT,
  -- Monotonic per admission: 1, 2, 3 ... The unique pair makes a second lease with the same sequence
  -- unrepresentable, so two concurrent authorizations cannot both claim to be the current one.
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  -- What the call asked to do, and what the LIVE intersection still allows. The operation is one of
  -- the two moments RUN-03 names; the capabilities are the subset still live at issue.
  operation TEXT NOT NULL CHECK (operation IN ('privileged_call','provider_dispatch')),
  capability TEXT CHECK (capability IS NULL OR capability ~ '^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,127}$'),
  effective_capabilities JSONB NOT NULL CHECK (jsonb_typeof(effective_capabilities) = 'array'),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  -- The signed token's identity: kid of the platform key and the SHA-256 of the compact JWS, so an
  -- operator can match a lease a runtime presents to the row that issued it without storing the token.
  signing_kid TEXT NOT NULL CHECK (length(signing_kid) BETWEEN 1 AND 128),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  UNIQUE (admission_id, sequence),
  -- NFR-06 / NFR-10 as a database fact: a lease is valid for at most 60 seconds after it was issued.
  CONSTRAINT workforce_run_lease_bounded CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '60 seconds'),
  CONSTRAINT workforce_run_lease_capability CHECK ((operation = 'privileged_call') = (capability IS NOT NULL))
);
CREATE INDEX workforce_run_leases_admission ON workforce_run_leases(admission_id, sequence DESC);
COMMENT ON TABLE workforce_run_leases IS
  'NFR-06/NFR-10: every run-authority lease ever issued. At most 60 s; monotonic per admission; immutable.';

-- No lease after a revocation. Checked in the database, not only in the service, because the whole
-- point of a durable revocation is that no writer -- including a buggy one -- can re-authorize past it.
CREATE FUNCTION workforce_run_lease_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM workforce_run_revocations WHERE admission_id = NEW.admission_id) THEN
    RAISE EXCEPTION 'a revoked admission authorizes nothing further' USING ERRCODE = '23514';
  END IF;
  -- The sequence only moves forward, by exactly one, so a gap or a rewind is refused rather than
  -- quietly accepted as "a newer lease".
  SELECT max(sequence) INTO latest FROM workforce_run_leases WHERE admission_id = NEW.admission_id;
  IF NEW.sequence <> coalesce(latest, 0) + 1 THEN
    RAISE EXCEPTION 'a lease sequence advances by exactly one' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workforce_run_leases_guard BEFORE INSERT ON workforce_run_leases
  FOR EACH ROW EXECUTE FUNCTION workforce_run_lease_guard();

CREATE FUNCTION workforce_run_authority_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'run authority records are immutable and retained' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER workforce_run_leases_immutable BEFORE UPDATE OR DELETE ON workforce_run_leases
  FOR EACH ROW EXECUTE FUNCTION workforce_run_authority_immutable();
CREATE TRIGGER workforce_run_leases_no_truncate BEFORE TRUNCATE ON workforce_run_leases
  FOR EACH STATEMENT EXECUTE FUNCTION workforce_run_authority_immutable();
CREATE TRIGGER workforce_run_revocations_immutable BEFORE UPDATE OR DELETE ON workforce_run_revocations
  FOR EACH ROW EXECUTE FUNCTION workforce_run_authority_immutable();
CREATE TRIGGER workforce_run_revocations_no_truncate BEFORE TRUNCATE ON workforce_run_revocations
  FOR EACH STATEMENT EXECUTE FUNCTION workforce_run_authority_immutable();

DO $harden$
BEGIN
  EXECUTE format('ALTER FUNCTION %I.workforce_run_lease_guard() SET search_path = %I, pg_temp', current_schema(), current_schema());
  EXECUTE format('ALTER FUNCTION %I.workforce_run_authority_immutable() SET search_path = %I, pg_temp', current_schema(), current_schema());
END $harden$;

-- DOWN
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM workforce_run_leases) OR EXISTS (SELECT 1 FROM workforce_run_revocations) THEN
    RAISE EXCEPTION 'run authority rollback refused: retained leases or revocations exist' USING ERRCODE = '23514';
  END IF;
END $$;
DROP TABLE workforce_run_leases;
DROP TABLE workforce_run_revocations;
DROP FUNCTION workforce_run_lease_guard();
DROP FUNCTION workforce_run_authority_immutable();
