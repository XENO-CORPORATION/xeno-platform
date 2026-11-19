-- UP
-- Each grant's available amount is remaining_micro minus the open holds funded from it
-- (usageCreditFunding.js planFunding and its two siblings: a per-grant subquery over credit_hold_funding JOIN
-- credit_holds WHERE state = 'held'). With only the (hold_row_id, grant_id) key, the planner probed every open hold
-- in the system once per grant, inside the transaction that holds the account row lock: on 2026-11-20 the busiest
-- account had 1,620 grants and 647 open holds, so one funding read was 1,048,140 index probes and 2.6 s, and billing
-- holds queued to a 14 s median (the gateway gives up at 3 s and answers billing_unavailable).
-- This index lets each grant read only its own funding rows: measured 2,610 ms -> 135 ms, holds 14 s -> 0.16 s.
-- It was created on production by hand that night (CREATE INDEX CONCURRENTLY); IF NOT EXISTS makes this a no-op there.
CREATE INDEX IF NOT EXISTS idx_credit_hold_funding_grant_cover
  ON credit_hold_funding (grant_id) INCLUDE (hold_row_id, reserved_micro);

-- DOWN
DROP INDEX IF EXISTS idx_credit_hold_funding_grant_cover;
