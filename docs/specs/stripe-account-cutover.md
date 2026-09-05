# XENOSYSTEM Stripe account qualification and cutover

Status: local qualification repair in progress; no external writes approved or performed.

## Contract and scope

XENO billing must be qualified against the operator-selected Stripe account, not
merely against any account with internally consistent prices. This bounded Tier 2
implementation strengthens the existing read-only billing preflight. The eventual
live cutover is Tier 3 and remains gated separately. No runtime behavior, customer
mapping, production configuration, API key, Stripe resource or legal identity is
changed by this implementation.

Lenses: money, credential safety, compatibility and operational evidence. No UI,
new data model or auth-session change is required for this bounded repair.

## Evidence ledger

- KNOWN: user selected XENOSYSTEM (`acct_1TwgCrLBe83UKv9x`). Stripe browser tab 6,
  account details and account status, inspected 2026-09-04: same ID/name, no active
  tasks; phone verification notice applies to payments from the Dashboard.
- KNOWN: account-details UI warns legal identity/address changes affect linked
  accounts. Those fields must remain untouched.
- KNOWN: `scripts/billing-preflight.mjs` checks prices/webhooks but not the account
  identity; it can pass for an unintended account, and does not require a matching
  publishable-key mode. `scripts/billing-preflight.test.mjs` executes the CLI with
  synthetic provider imports and an isolated environment.
- KNOWN: `src/server/services/billingService.js` stores customer IDs without an
  account/mode namespace in `billing_customers`; changing keys alone is not a
  qualified migration. Historical server read-only evidence used a TEST key for
  `acct_1TZps0V05dWPT2ni`, not XENOSYSTEM. Recheck before cutover.
- UNKNOWN: XENOSYSTEM API credentials, exact live capabilities, catalog, webhook
  configuration, tax/portal readiness and current database mapping inventory.
  Resolve by secure credential handoff and read-only API/DB qualification.

## Interfaces and invariants

Add `STRIPE_EXPECTED_ACCOUNT_ID` (explicit `acct_` identifier) and
`STRIPE_EXPECTED_MODE` (`test` or `live`) as mandatory preflight inputs; no default
to XENOSYSTEM, so isolated sandboxes can be explicitly pinned too.

1. Missing/malformed expected identity/mode, malformed API key, or missing/wrong-mode
   publishable key fails before any provider request. Require expected mode =
   secret-key mode = publishable-key mode. Support account-level `sk_`
   and restricted `rk_` test/live keys; organization keys are outside this interface.
   Check: executed CLI configuration-mutation tests.
2. Retrieve the authenticated account with `stripe.accounts.retrieve()` (no ID
   argument or connected-account header). Require object `account` and exact ID
   equality. On mismatch/malformed response/exception fail and skip price/webhook
   requests. Check: instrumented CLI account-failure tests.
3. Live mode additionally requires strict boolean true for `charges_enabled`,
   `payouts_enabled`, `details_submitted`, requirements currently_due/past_due/
   pending_verification as empty arrays and disabled_reason explicitly null.
   Missing/unknown state is not proof. Test mode does not claim live capability.
   Check: negative live capability/requirements CLI tests and positive test/live.
4. All existing price and webhook checks remain required after account validation.
   Their success is configuration evidence only: not publishable-key ownership,
   webhook-secret matching/delivery, tax compliance or a completed checkout.
   Check: existing price/webhook suite and explicit CLI scope disclaimer.
5. Account/configuration failures print static messages; never print the account
   object, key, provider exception or malformed expected ID. Preserve existing
   catalog diagnostics only after guarding provider currency (three lowercase
   letters), interval (day/week/month/year or absent), and amount (nonnegative
   safe integer or null/absent); malformed values get a static failure. Require
   explicit Price livemode matching expected mode. Check: secret sentinel and
   malformed price-response CLI tests. Provider actions remain reads; no DB writes.

## Sequence and failure behavior

Compile, independent falsification, implement, run billing preflight/harness and
adjacent checkout tests, record results. The preflight fails with exit 1 on unknown
or inconsistent state. No rollback of provider state is needed because it only
reads; revert only owned source hunks to undo this local change.

## Later live boundary (not approval or execution)

Securely acquire a XENOSYSTEM credential without showing it in chat. Inventory
account/catalog/endpoints and existing DB customer/subscription mappings. Prove
isolated hosted test transactions and provider-delivered events. Prepare exact
live resource/config changes derived from the canonical catalog, a reviewed
artifact, backup/restore and an account-aware treatment of old mappings and
in-flight events. Then obtain one explicit go/no-go for that specific set of
changes. No charges, key rotation, shared business edits or automatic customer
deletion. After the first live payment, rollback cannot merely restore the DB:
retain and reconcile all newly accepted money and events.

## Reconciliation

Independent review: accepted missing explicit expected/secret/publishable mode
equality (invariant 1 clarified); accepted unsafe provider-derived price diagnostic
text (invariant 5 now guards interpolated fields). No FATAL redesign required.
Executed CLI and adjacent gates: `node --test scripts/billing-preflight.test.mjs
scripts/paid-loop-proof.test.mjs scripts/billing-checkout-price.test.mjs`:
69 passed, zero failed/skipped. Includes actual subprocess negative account/mode,
capability, exception and malformed-price cases, using synthetic provider imports.
Live cutover remains unexecuted; no runtime enforcement is claimed.

Additional live browser observations, 2026-09-04: XENOSYSTEM product catalog shows
All 0 / Active 0 / Archived 0. Workbench Event deliveries shows no destinations
created. The local owner-restricted secret store has no Stripe-named credentials;
its ACL permits only the owner and SYSTEM. API-based XENOSYSTEM verification still
requires a secure credential handoff. No secret was revealed or copied.

Current server identity reverified read-only on 2026-09-04 using
`ssh xeno-platform-001` and stdin Node in `xenostudio-backend`:
`acct_1TZps0V05dWPT2ni`, test mode. A READ ONLY transaction counted
`billing_customers=2`, `billing_events=0`, `xeno_account_plans=7`.
Counts do not establish whether provider subscriptions exist or whether those
plans are paid; no rows were modified. Preserve and qualify these mappings
before changing account keys. Rootless receipt contains only counts and account ID.

First default regression correctly failed on missing Docker environment pass-through
for the two new pins. Added empty-default slots to repository `docker-compose.yml`;
no compose application, server change or preview restart. Final default rerun
exited 0: 1,296 tests, 1,274 passed, 22 skipped, zero failures/cancellations across
84 summaries. Log: `C:/Users/bnkr/AppData/Local/Temp/xeno-account-pin-regression-final-20260904.log`.
Node syntax and scoped diff checks passed. No UI build is claimed for this
script/config-only change.

### Secure credential handoff verified — 2026-09-04

User saved `STRIPE_XENOSYSTEM_LIVE_KEY` through the hidden-input saver. Read-only
`GET /v1/account` confirms `acct_1TwgCrLBe83UKv9x`, live key, charges/payouts enabled
and details submitted. Key value was not displayed. Both the default API response
and explicit `2025-02-24.acacia` response omit `requirements` and
`future_requirements`; this is UNKNOWN, not proof of outstanding requirements or
empty requirements. An initial PowerShell array-count probe counted null as one;
explicit presence/type checks corrected that observation. The current conservative
live preflight therefore remains unsatisfied; determine the account response
contract before changing its evidence policy.

Live API listings (limit 100, `has_more=false`) confirm zero products, prices,
webhook endpoints, billing-portal configurations and tax registrations. Tax
settings report active, with defaults and head office present; this is not a tax
compliance decision. No provider writes, purchases, deployment, backend secret
change or migration occurred. The secure-secret skill kept all credentials out
of the transcript. Next: qualify account response semantics, prepare the exact
catalog/webhook/portal setup and isolated transaction plan before live cutover.

### Nullable own-account response correction — 2026-09-04

This section supersedes invariant 3's unconditional requirements-object demand;
the original is retained as the disproved premise. Scope remains local Tier 2.
KNOWN: https://docs.stripe.com/api/accounts/object documents requirements as nullable,
charges_enabled as ability to process charges, and payouts_enabled as ability to
pay out funds. Authenticated GET /v1/account with API version 2025-02-24.acacia
reconfirmed the intended ID, type=standard, controller.type=account, strict enabled
flags and capabilities.card_payments=active; requirements absent. This does NOT
prove that no verification tasks exist, nor why the field was omitted.

Replacement invariant 3: strict true charges_enabled/payouts_enabled/details_submitted
remain mandatory. Present requirements must still be an object with explicit null
disabled_reason and empty currently_due/past_due/pending_verification arrays.
Only null/absent requirements on type=standard AND controller.type=account AND
capabilities.card_payments=active may proceed, with a static warning that verification
details were not exposed and Dashboard review remains necessary. Other missing,
malformed, nonempty or unknown cases refuse before downstream reads. No operator
bypass flag. API version pinned to the runtime's 2025-02-24.acacia.

Acceptance: executed CLI positive omitted/null own-account cases, negative type,
controller, card capability, strict flags and malformed/present requirements cases;
assert warning appears only for the nullable branch, provider fields never leak,
and refused accounts cause zero price/webhook reads. Existing price and webhook
tests remain green. Rollback is scoped source-hunk reversal; no provider state
changes. Independent falsification precedes implementation. This is configuration
qualification, not KYC approval or permission to activate payments.

Reconciliation: fresh independent falsifier returned NO FINDINGS. Implemented the
nullable branch and pinned version. Focused CLI/preflight/checkout/paid-loop suite:
71 passed, zero failures/skips. Node syntax and scoped diff checks passed. No full
suite rerun for this follow-up; the earlier 1,274-pass run precedes this change.

### Resource preparation (not executed)

The following is a review snapshot of `billingService.js` CATALOG, not a second
runtime catalog. Re-derive and compare before provisioning; never provision a
changed catalog from this snapshot. Existing setup-call search in worktree scripts
found no products.create/prices.create/portal-configuration creator. The older
TAX-POSTURE reference to `stripe-create-prices` has not established its location.

Target: XENOSYSTEM `acct_1TwgCrLBe83UKv9x`, live; initial products/prices both zero.
All prices EUR, per_unit, active, no transform or custom amount, inclusive tax
per locked `docs/TAX-POSTURE.md`. Tax registrations and business identity remain
untouched. One product per catalog ID with stable XENO metadata; ten prices:

| Catalog ID | Minor-unit amount | Recurrence | Credits |
|---|---:|---|---:|
| credits_small | 1000 | one-time | 1000 |
| credits_medium | 5000 | one-time | 5500 |
| credits_large | 10000 | one-time | 12000 |
| pro_monthly | 2400 | month, 1, licensed | 0 |
| pro_annual | 22800 | year, 1, licensed | 0 |
| everything_monthly | 3900 | month, 1, licensed | 0 |
| everything_annual | 34800 | year, 1, licensed | 0 |
| team_seat | 4000 | month, 1, licensed, per seat | 0 |
| team_annual | 38400 | year, 1, licensed, per seat | 0 |
| studio_monthly | 9900 | month, 1, licensed | 0 |

Leave legacy team_monthly unset. Founding/list offer filtering stays canonical.
Do not activate subscriptions or create customers as part of catalog provisioning.
On retry, list all pages and verify metadata plus full price agreement before reuse;
ambiguous ownership or mismatches stop, never modify an existing price to force fit.
Record created IDs and idempotency keys. Unused newly created resources can be
archived; consumed prices and customer history must be retained and reconciled.

Webhook: eventual exact destination https://xenostudio.ai/api/billing/webhook,
API 2025-02-24.acacia, derive enabled events from the deployed handler, currently:
checkout.session.completed, checkout.session.async_payment_succeeded,
invoice.paid, invoice.payment_succeeded, invoice.payment_failed,
customer.subscription.created, customer.subscription.updated,
customer.subscription.deleted, charge.refunded, charge.dispute.created,
charge.dispute.funds_withdrawn. Do NOT attach live delivery while the backend still
uses the old account; secret provisioning and receiver cutover must be coordinated.

Portal: current runtime uses the account's default configuration. Configure and
verify that default (not merely a non-default configuration ID), with invoices,
payment-method updates and end-of-period subscription cancellation. Qualify hosted
portal behavior in the isolated sandbox before deciding on plan-switch controls.

Before any live apply: isolated XENOSYSTEM sandbox credentials and destination;
hosted checkout, signed delivery, ledger/entitlement, renewal/cancellation/refund,
receipt and re-login evidence; mapping/in-flight-event inventory and tested restore;
then one exact action-time approval. None of these preparation notes is a go-live
approval, a completed provider test, or a new legal/tax determination.
