# Provider paid-loop harness safety

Status: Tier 2 local implementation; external execution requires a separate action-time approval.

## Contract

Repair the existing provider qualification harness so it cannot silently use a live
Stripe key or the normal preview/production database, cannot pass a failed cleanup,
and exercises the current checkout consent contract. Default execution is an offline
plan, not a passing payment test. Preserve all hosted checkout, renewal, refund,
receipt and relogin requirements in the launch register.

## Evidence ledger

- KNOWN: `scripts/paid-loop-proof.mjs` rejects only `sk_live_`, accepts arbitrary
  database configuration, catches cleanup failures without failing, and deletes
  consent evidence. It does not complete the hosted checkout page.
- KNOWN: `src/server/services/checkoutConsent.js::requireCheckoutConsent` can
  discover a consent when its ID is omitted. The omission is not itself proof of
  failure. Supplying the exact recorded ID makes qualification unambiguous.
- KNOWN: `billingService.js::createCheckout` returns `{url,id}`, creates a customer
  marked with `xenoUserId`, and consumes the consent after session creation.
- UNKNOWN: current remote provider configuration and hosted delivery. Resolve by
  authorized provider preflight and a separate real journey; do not simulate a pass.

## Scope / interfaces

Keep `node scripts/paid-loop-proof.mjs` (offline plan) and `--confirm` (mutating
test-only qualification). Extract injectable orchestration into
`scripts/lib/paid-loop-proof.mjs` for negative behavioral tests. Only the checked-out
service modules are imported; no catch-all layout fallback masking import failures.
No production billing/auth behavior is changed.

Confirmed mode requires `NODE_ENV=test`, `STRIPE_SECRET_KEY` matching `sk_test_` or
`rk_test_` plus alphanumerics, explicit DB host `127.0.0.1` or `::1`, explicit port,
user/password, and `DB_NAME=xeno_paid_loop_<32 lowercase hex run ID>`, with
`XENO_PAID_LOOP_RUN_ID` matching. Actual `current_database()` and its database
comment must equal that name and `xeno-paid-loop:<run ID>`. This is an explicitly
prepared disposable database, not a name-based assertion of ownership. Reject
DATABASE_URL/PG connection overrides and non-loopback BILLING_APP_URL. No schema
provisioning by the harness, target restart or credential installation occurs here.
The unchanged billing service's idempotent `ensureSchema` runs on this disposable
target; it is not evidence that production startup migrations were qualified.

## Invariants / checks

- INV1 offline-default: no arguments performs no imports of service/provider/DB,
  no network or writes, and says UNEXECUTED. Unknown/duplicate arguments fail.
- INV2 target-refusal: missing, live, malformed/unknown keys; shared database;
  wrong run marker/comment; environment overrides refuse before any writes.
- INV3 consent-binding: negative call must fail with exact `consent_required`;
  positive call passes the returned consent ID. Verify its stored session binding.
  Any checkout failure stops subscription creation. Validate HTTPS Stripe URL by
  exact origin (never substring) and returned test session identity.
- INV4 cleanup-failure: cleanup discovers customers by the run's unique invalid
  email, verifies email/test mode/user metadata, expires their open checkout
  sessions and cancels nonterminal subscriptions, verifies those terminal states,
  deletes the customer and verifies deletion. All list pages must be visited;
  read/cleanup errors make the run fail. No raw provider/DB exceptions or URLs
  enter output. An uncertain provider outcome cannot become a passing result.
  Wrap the pool passed to all services so even swallowed query errors fail the
  receipt. In the dedicated CLI process, suppress imported-service console output
  and treat console errors as failures; only the sanitized receipt is printed.
- INV5 evidence-retention: no SQL DELETE/DROP; disposable DB/audit records remain
  for reconciliation. Report retained database and owned customer/subscription/
  session IDs, never credentials. Hard process termination requires reconciliation
  using the run marker; automatic crash recovery is not claimed.
- INV6 exact-entitlement: require `pro/active` after creation, strict true download
  entitlement, then canceled status and strict false entitlement after cancellation.
  Missing/undefined results cannot count as revocation. Polling is bounded.

Checks: behavioral `scripts/paid-loop-proof.test.mjs` for every invariant with
injected provider/DB/service failures; real CLI dry-run and refusal subprocesses.
Include in default test chain via billing-preflight gate.

## Failure / state model

Offline plan -> validate -> read-only DB ownership preflight -> create fixture ->
consent refusal -> exact consent checkout -> subscription -> poll/entitlement ->
cancel/poll/entitlement -> provider cleanup -> receipt. Failure skips later business
steps, attempts cleanup only after fixture ownership was established, retains DB
evidence and exits nonzero. Each cleanup failure is recorded independently.
Provider API timeout 10 seconds, retries disabled for harness calls. Production
checkout retains its own retry policy; no claim of a whole-run hard deadline.

Confirmed mode additionally requires `XENO_PAID_LOOP_WEBHOOK_URL`, an HTTPS
isolated endpoint ending `/api/billing/webhook`, excluding xenostudio.ai and www.
Before fixture writes, enumerate every webhook page: refuse any enabled destination
other than this endpoint, require explicit test mode and full handled-event coverage
through the existing canonical verifier. A separate sandbox is needed when the
existing Stripe test account serves the deployed platform. Destination changes or
unregistered CLI forwarders during execution are outside this check and must be
excluded operationally before approval. Checks: sharedWebhook + webhook verifier.

Stripe test records/events cannot all be erased. Cleanup means terminal external
resources verified, NOT historical provider record erasure. The actual isolated
endpoint must be shown to use the marked DB before execution; URL settings alone
cannot establish that runtime binding. A `.invalid` test email cannot receive email.

## Plan / acceptance / rollback

1. Independent fresh-context falsification; adjudicate findings here.
2. Implement and run positive/negative behavior tests plus offline CLI.
3. Run adjacent payment regression and typecheck; record results.
4. Real provider run remains NOT RUN pending disposable schema + correctly routed
   test webhook + test credentials + explicit approval. Hosted journey still open.

Rollback: revert only this change's source hunks, preserving unrelated WIP. No
database migrations or external writes are part of this implementation turn.
Lenses: money, security, observability. No UI styling or release publication.

## Independent falsification

F1 MATERIAL accepted: effective-plan and subject-hash dependencies can swallow and
log DB failures. Pool-level failure tracking plus dedicated-process console capture
is required, with swallowed-error and secret-sentinel tests.
F2 MATERIAL accepted: unchanged billing service runs idempotent ensureSchema. The
no-provisioning claim is narrowed to the harness, not its production dependency;
all such DDL is restricted to the explicitly marked disposable target.

## Reconciliation

INV1–6 are covered by 25 offline behavioral tests, including exact consent ID and
stored binding, wrong database marker, live/restricted-live refusal, shared webhook
refusal, swallowed SQL error, wrong/undefined entitlement, lost response recovery,
pagination, unresolved known resource and cleanup no-op/failure. Together with the
existing price/webhook suite, 57 focused tests pass. No real transaction has run.
The added webhook isolation requirement strengthens INV2 after read-only discovery
that the existing test provider account delivers events to the deployed platform.
The receipt intentionally retains disposable SQL evidence (no DELETE/DROP) and
reports service-loop-only scope, not complete PAY-1 qualification.
