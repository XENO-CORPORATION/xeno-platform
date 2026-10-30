# Workforce compensation: agreements + credits, a person approves — APPROVED (owner, 2026-10-29)

Owner's choice (2026-10-29): *"Agreements + credits, a person approves"*, over "record agreements only" and
"full payroll in XENO".

## Context

The work report (`services/workforceEvaluation.js`, LIFE-04) now shows what each person and agent directed, did,
checked and spent. The owner asked for compensation on top of it. Decisions already on record:

- **Spec D13:** no implicit payout, bounty or reward; paid work requires its own accepted agreement/budget.
- **Spec D18:** employment is an admission plus a title; a separate record only for facts an admission can't hold
  (a revenue share).
- **Marketplace D6:** money is credits on the existing ledger; cash-out to real money via Stripe Connect later.

## Choice

- `workforce_comp_agreements`: how a member is paid — fixed per period, per task a **person** accepted from
  review, a revenue share (recorded; no member revenue exists yet, so it prepares at zero and says so), or a
  salary paid **outside** XENO (recorded for CSV export to a payroll provider). One active agreement per member; a
  new one ends the old one.
- `workforce_comp_payouts`: one period's payout, **prepared** from the agreement and the member's own work report
  (same projection, evidence and task ids kept on the row), then **approved** (optionally with another amount, the
  prepared one kept beside it) or **skipped** by a human workspace administrator. Approving pays.
- Money: workspace wallet → payee over the existing ledger (`recordUsageV2` debit, then a paid grant + the payout
  marked paid in one transaction), keyed `ws-comp:<payout id>`, so a retry pays once. An agent's pay goes to its
  owner. An empty wallet refuses and moves nothing; the payout stays approved until funded.
- People › Pay (`/workspace/workspace/Directory/pay/<start>/<week|month>`); routes `/api/compensation`.

## Rules (held in the service and by triggers)

Only a person sets agreements or decides payouts, never an agent (no agent tool exists); a decided payout is fixed;
nothing is deleted. The counts **prepare** a payout and never decide it (GDPR Art. 22; AI Act Annex III 4(b)).

## Not built (on purpose)

Real-money payroll (bank payouts, payslips, tax and social contributions) — a regulated build, and Stripe waits
for the owner. Revenue attribution to members. A notice to the member when paid.

## Blast radius

Two new tables (additive), `routes/compensationRoutes.js`, `services/workforceCompensation.js`,
`prototypes/xeno-workspace/platform-pay.js`. Ledger code unchanged.

## Rollback

The migration's DOWN drops both tables only when none hold a row (executed on a copy: DOWN then UP, 2026-10-29).
Revert the change to remove the routes and screen.

## Proven (2026-10-29)

`scripts/workforce-compensation.test.mjs` (real Postgres + the real ledger; 6 parts; mutations caught: paying for
unreviewed tasks, an agent deciding at the database), `scripts/workforce-migration-chain.test.mjs`, and the People
browser test `prototypes/xeno-workspace/tests/directory-test.mjs` (prepare → confirm → 20 credits reached the member;
the member sees their pay and cannot decide it).
