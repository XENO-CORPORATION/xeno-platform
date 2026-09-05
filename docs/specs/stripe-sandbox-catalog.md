# Isolated Stripe catalog qualification

Scope: local Tier 2 tooling plus user-approved test-only provisioning. User approved
dedicated XENOSYSTEM sandbox and continued testing on 2026-09-04. Created through
Stripe's non-binding sandbox form with live copying OFF; browser confirms parent
XENOSYSTEM and sandbox `acct_1UBwYiLLJZjl9ISl`, name XENOSYSTEM Platform Qualification.
No production deployment, live prices, legal changes or real charges in this slice.

KNOWN: billingService.js getInternalCatalog owns price IDs, amounts, recurrence and
credits; TAX-POSTURE.md locks inclusive pricing. Existing scripts contain no catalog
creator. billingWebhookVerification owns event coverage. Stripe SDK is backend-owned.
VERIFIED: saved test secret authenticates the pinned sandbox account; empty initial
products, prices, customers and webhook endpoints. Independent falsification: no findings.
UNKNOWN: isolated receiver and complete
hosted checkout evidence. Catalog creation does not close any payment proof gate.

## Contract

Add a CLI with offline plan default and exact --confirm for TEST-only provisioning.
Use canonical getInternalCatalog; no second price list. Confirm requires sk_/rk_test
credential plus explicit expected account equal to this dedicated sandbox ID. Read
authenticated /v1/account and match before any catalog calls. Pin API to runtime.
Never accept live keys, organization keys, other accounts, unknown arguments or
missing pins. No webhook destination changes, customer creation or DB access.

Plan: deterministic items from nonlegacy catalog, integer minor EUR amounts,
positive safe integers, unique ID/env, subscription month/year licensed interval=1,
one-time credits, inclusive, no custom quantity/transform, one product per item.
Validate all catalog input before provider calls, refuse unsupported/duplicate data.

Read all pages of products and prices before writes, with pagination failure refusal.
Owned metadata marker xenoQualification=platform-catalog-v1 plus xenoCatalogId.
Ambiguous/malformed owned objects or any existing price mismatch must refuse before
any writes, including later-item mismatch. No updating/deleting existing resources.
Reuse only explicit active test objects matching metadata, product linkage and full
priceAgreement plus tax_behavior=inclusive and metadata. Orphan owned price refuses.
Do not modify unowned resources; they are outside this operation. For each missing
product/price create with deterministic idempotency keys from the pinned account,
catalog ID and full immutable price tuple; validate returned objects before recording
success. A changed tuple with pre-existing metadata objects fails, never reprices.

Partial provider failure stops subsequent writes; no false rollback promise. Retain
created Stripe objects for metadata-based reconciliation on retry. Same parameters
have stable idempotency keys; no automatic delete. Console suppresses raw dependency
errors; output only static failure or validated IDs and item/env mapping. Never key,
raw exception, customer information or arbitrary provider metadata text. Qualification
result says catalog-only, not paid-loop pass. No source copies of secret values.

## Acceptance

Injected tests: valid plan, malformed/duplicate catalog, missing/live/wrong account,
API version pin, pagination, wrong/ambiguous existing resources before any write,
clean create, no-write rerun, partial response failure then safe retry, immutable
price tuple mismatch, malformed response and sanitized CLI failures. Include in
billing test script. Run focused tests before real sandbox apply. Real apply only
after GET authenticates sandbox ID; verify all resulting prices with same validators.
No destructive rollback: archive only unused created resources if later explicitly
requested; retain test event history. Receiver/DB/payment journey remains separate.

Independent falsification before implementation; no UI, auth or production changes.

## Execution evidence — 2026-09-04

- Independent spec falsifier: NO FINDINGS.
- `node --test scripts/stripe-sandbox-catalog.test.mjs`: 42/42 pass.
- `npm run test:billing-preflight`: 106/106 pass including existing billing and
  isolated service-loop harness tests. These are injected/local tests, not payment proof.
- Offline CLI read the ten nonlegacy canonical entries without provider calls.
- Authenticated sandbox apply created ten products and ten prices; post-write GET
  inventory passed ownership, amount, currency, interval, active/test mode and tax checks.
- A second authenticated run returned the same complete catalog and created zero
  products/prices. No live resources, webhook endpoints, customers or DB rows changed.

Validated sandbox price mapping (not usable against the live account):

| Environment name | Sandbox price ID |
| --- | --- |
| STRIPE_PRICE_CREDITS_LARGE | price_1UBwiQLLJZjl9ISlXrYmCK4U |
| STRIPE_PRICE_CREDITS_MEDIUM | price_1UBwiRLLJZjl9ISlMiPFh3BK |
| STRIPE_PRICE_CREDITS_SMALL | price_1UBwiSLLJZjl9ISlBd53vro6 |
| STRIPE_PRICE_EVERYTHING_ANNUAL | price_1UBwiSLLJZjl9ISlxoiTUy9I |
| STRIPE_PRICE_EVERYTHING_MONTHLY | price_1UBwiTLLJZjl9ISlgPqgZiVi |
| STRIPE_PRICE_PRO_ANNUAL | price_1UBwiTLLJZjl9ISl36U10tYj |
| STRIPE_PRICE_PRO_MONTHLY | price_1UBwiULLJZjl9ISlhyhWJE8T |
| STRIPE_PRICE_STUDIO_MONTHLY | price_1UBwiULLJZjl9ISl3Kg8V8fM |
| STRIPE_PRICE_TEAM_SEAT_ANNUAL | price_1UBwiVLLJZjl9ISlKmqB0o8J |
| STRIPE_PRICE_TEAM_SEAT_MONTHLY | price_1UBwiWLLJZjl9ISlwMQNEVok |

Next qualification boundary: isolated signed-webhook receiver and disposable DB;
then provider-to-ledger/entitlement delivery, hosted Checkout, renewal, refund,
cancellation, portal, receipts and browser relogin. This catalog result is not a
production cutover or a public-readiness verdict. Do not configure a shared backend
with these IDs while its customer mappings belong to another Stripe account.
