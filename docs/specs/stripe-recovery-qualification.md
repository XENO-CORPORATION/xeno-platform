# Stripe public delivery and recovery qualification

Contract: prove actual signed public HTTPS delivery, deliberate endpoint outage,
provider redelivery, duplicate safety and stale-event cancellation safety in the
dedicated TEST sandbox. This extends, rather than replaces, the remaining launch gates.

KNOWN: `scripts/stripe-delivered-loop.mjs` creates a fresh marked PostgreSQL DB,
isolated receiver and owned Stripe endpoint; cleanup verifies deletion and stops
the tunnel/container. Public run ec5c9490d938ce2a0ca0e61a8bed2363 passed four
signed events on 2026-09-04 (`xeno-delivered-loop-AAfBM9/report.json` in TEMP).
KNOWN: `billingService.js:handleEvent` retrieves current subscription state for
subscription events; `deliveryReceiver` verifies signatures and test mode before
dispatch. `runProof` binds plan/entitlement to exact subscription.
RESOLVED: provider redelivery after an actual 503 and stale duplicate maintained
correct durable state in run 186e8874a842fd69a5e7ff38cc085ffe. The exact activation
event reconciled three times; duplicate active state and post-cancel state were
unchanged. Safe report: TEMP/xeno-delivered-loop-2eLpwk/report.json.

Tier 2 harness changes; already approved sandbox-only fixture operations. No live
charges, existing customers, public application deployment, auth changes, email or
merchant settings. Receipt delivery and full signed-in browser flow remain required
but are not implied by webhook evidence. Lenses: money, concurrency, security,
network, observability. No UI redesign.

## Interfaces and invariants

- Receiver exposes an in-process pause control only (no HTTP control route),
  default off. After valid signature/test/Connect checks, paused delivery returns
  503 without invoking any handler. Safe rejected-event receipts are separately
  bounded; expected outage rejections never hide unexpected handler failures.
- Recovery pauses before direct subscription creation, blocking ALL handler calls
  so invoice events cannot satisfy activation indirectly. Wait for exact rejected
  customer.subscription.created event for the owned subscription, retrieve it from
  Stripe and verify id, type, test mode, customer and subscription before resend.
- Before resume, durable plan is not active and entitlement is closed. Then resume
  and use documented `stripe events resend ID --webhook-endpoint=ID` with the pinned
  sandbox key. Command exit is not proof: require an awaited reconciled receipt
  for the exact event and exact active DB subscription plus open entitlement.
- Resend the SAME event again; require an increased receipt count for that ID,
  unchanged effective plan/period/subscription and credit balance/journal count.
- After canonical cancellation closes access, resend the original created event;
  require an additional reconciled exact-event receipt and canceled DB state/access
  still closed. Never inject payloads or call handlers directly as provider proof.
- All waits bounded (90s default); wrong owner, absent receipt, no-op response,
  changed balance, unexpected handler failure or cleanup failure fails the run.
- Always resume in finally so cleanup cancellation can reconcile. Failed runs
  retain safe IDs and SQL evidence, never raw provider output or credentials.

Acceptance: negative unit tests for signature bypass, failed receipt, wrong owner,
unrecovered state and duplicate mutation; real public run with rejected delivery,
three exact-event successes and canonical cancellation; focused/full regressions.
Rollback: source reversible, only fresh owned sandbox fixtures modified. Existing
lost-response/cleanup guards remain. No shared preview restart or DB swap.

Plan: independent falsification; implement receiver/helper/hooks/tests; run fresh
public recovery fixture; reconcile evidence. Delayed settlement, email, browser,
and live release remain independent acceptance criteria, not retired requirements.

Independent falsification P2 ACCEPTED: receiver drain was unbounded. Drain now
rejects after 15 seconds; pool close also has a 15-second deadline and timeout
continues owned container shutdown while keeping the overall verdict failed.
Regression holds a handler unresolved, asserts timeout, then releases it and
verifies normal drain remains usable. This does not simulate a production DB crash.

Execution evidence: focused gate 133/133 passed; public recovery run exit 0,
four accepted signed events, three deliberate 503s, two rejected unsigned probes,
zero handler failures. Owned customer and endpoint removed, tunnel stopped,
owned database stopped and retained. Automatic retry timing, deployed application
ingress, receipt email and browser relogin are not implied by this result.

Final full regression: 1,367 tests, 1,345 passed, 22 skipped, zero failed,
exit 0. Skipped tests remain unqualified. The public recovery contract above is
satisfied; the independent launch requirements listed above remain open.
