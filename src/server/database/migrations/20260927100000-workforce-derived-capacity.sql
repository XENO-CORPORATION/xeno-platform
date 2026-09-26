-- UP
-- XENO-WORKFORCE-01 LIFE-09 -- capacity is DERIVED, never declared.
--
--   LIFE-09: "How much a workforce can take on is a projection over active admissions, remaining
--             budget envelopes (RUN-10) and in-flight runs -- the same discipline as DIV-07's
--             ledger-derived balance. A stored headcount or capacity number is a cache with no
--             invalidation, which is the failure mode this estate records most often."
--
-- So this adds VIEWS and no table. A view is a query with a name: it stores nothing, so there is no
-- number to go stale, and every read recomputes it from the rows that decide it -- admissions, their
-- revocations and their leases (the ledger half is read by the service; see the note at the end). The migration-chain gate pins
-- the workforce schema to its tables, so a `workforce_capacity` TABLE would fail it; that is the point.
--
-- ── WHAT "ACTIVE" AND "IN FLIGHT" MEAN HERE, AND WHY ─────────────────────────────────────────────
--   active     an admission with no revocation. RUN-03's durable revocation is the ONLY thing that
--              ends one, so "not revoked" is the whole predicate -- no status column to drift from it.
--   in flight  an active admission holding a lease that has not expired. A lease lives at most 60 s
--              (NFR-06), so this is "doing work right now", derived from the clock and never cached.
--   committed  the budget ceilings of active admissions -- the envelope each run was approved to spend.
--   funds      the payer's balance minus their live holds -- the same arithmetic admission uses.
--
-- ── WHAT IT DELIBERATELY DOES NOT CLAIM ──────────────────────────────────────────────────────────
-- RUN-10 (nested runs share a parent budget through child sub-reservations) and FUND-06 (a workspace
-- pool) are unbuilt, so every admission today is paid by one account and has no parent. `funds` is
-- therefore per PAYER, and the scope view reports the payers it depends on rather than inventing a
-- pooled balance no ledger holds. When those land, this view is where the envelope arithmetic goes --
-- one place, still derived.

CREATE VIEW workforce_admission_activity AS
SELECT a.id AS admission_id,
  a.target_kind, a.target_owner_user_id, a.target_workspace_id, a.project_id,
  a.agent_resource_id, a.payer_user_id, a.budget_ceiling_micro,
  (r.admission_id IS NULL) AS active,
  (r.admission_id IS NULL AND EXISTS (SELECT 1 FROM workforce_run_leases l
     WHERE l.admission_id = a.id AND l.expires_at > clock_timestamp())) AS in_flight,
  a.admitted_at
FROM workforce_run_admissions a
LEFT JOIN workforce_run_revocations r ON r.admission_id = a.id;

-- One row per SCOPE a run can target: a workspace, or a personal owner.
CREATE VIEW workforce_scope_capacity AS
SELECT
  CASE WHEN target_workspace_id IS NOT NULL THEN 'workspace' ELSE 'user' END AS scope_type,
  COALESCE(target_workspace_id, target_owner_user_id) AS scope_id,
  count(*) FILTER (WHERE active)::bigint AS active_admissions,
  count(*) FILTER (WHERE in_flight)::bigint AS in_flight_runs,
  count(DISTINCT agent_resource_id) FILTER (WHERE active)::bigint AS active_agents,
  COALESCE(sum(budget_ceiling_micro) FILTER (WHERE active), 0)::numeric AS committed_ceiling_micro,
  COALESCE(array_agg(DISTINCT payer_user_id) FILTER (WHERE active), '{}')::uuid[] AS active_payers
FROM workforce_admission_activity
GROUP BY 1, 2;

-- What each payer can still FUND is not a view: credit_holds is created by migrate-account-v2.js, which
-- runs AFTER this versioned chain (baseline.sql, step 3), so a view over it would break a fresh database.
-- services/workforceCapacity.js reads it at request time with the same arithmetic admission uses.

-- DOWN
DROP VIEW workforce_scope_capacity;
DROP VIEW workforce_admission_activity;
