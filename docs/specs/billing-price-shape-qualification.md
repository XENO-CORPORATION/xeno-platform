# Billing price-shape qualification

Status: Tier 2, implemented and locally verified; 2026-09-04. Target configuration remains unqualified.

## Intent and evidence

Strengthen PAY-2's read-only preflight without changing prices, customer accounts,
checkout behavior or ledger state. This does not qualify hosted payment delivery.

BASELINE KNOWN (before this slice): `src/server/services/billingService.js` CATALOG declares fixed EUR monthly,
annual and one-time products; personal checkout sends quantity 1 and team checkout
sends seat quantity. `src/server/utils/priceAgreement.js` currently checks interval
but not interval_count, usage_type, billing_scheme or quantity transformation.
`scripts/billing-preflight.mjs` prints raw price lookup error messages.

KNOWN: Stripe's Price schema defines interval_count, licensed/metered usage,
per_unit/tiered billing, adjustable custom amounts and quantity transformations:
https://docs.stripe.com/api/prices/object

INFERRED: matching amount/currency/interval alone cannot establish the catalog's
fixed per-period or per-seat price contract.

UNKNOWN: target Stripe configuration and actual provider-delivered payment flows.
No credentials or provider writes are needed for this slice.

## Invariants and acceptance

- INV-1: retain amount, currency, archived, subscription/one-time checks; accept
  only explicit active=true and billing_scheme=per_unit. Reject non-null custom
  amounts and transform_quantity. Tests cover correct plans, packs and negatives.
- INV-2: subscriptions require the catalog interval, interval_count exactly 1 and
  usage_type exactly licensed. Missing/unknown required fields fail. Annual plans
  and per-seat plans are positive cases; 3-month cadence and metered are negative.
- INV-3: price lookup errors print only the catalog item/env NAME and fixed advice,
  never provider exception content. Execute the CLI with a synthetic Stripe module
  that throws a sentinel secret; assert nonzero status and no sentinel in output.
- INV-4: CLI stays read-only and every mismatch yields nonzero exit. No checkout,
  auth, payment fulfillment, catalog price, tax policy or frontend changes.

## Implementation and verification

Extend the existing pure priceIssues helper, not a second catalog. Add realistic
Price fixtures and adversarial tests to billing-preflight.test.mjs. Use a Node
module interception fixture for the CLI failure regression, with synthetic env
and no network or database. Run billing-preflight tests and adjacent billing gates.

## Failure and rollback

Unknown/malformed provider data refuses readiness. The existing application runtime
is unchanged; this guard does not prevent a deployment that bypasses preflight.
Revert only this slice's hunks if needed, preserving pre-existing dirty edits.

## Falsification

One fresh-context pass completed; no fatal/material blocker.

- F1 MINOR accepted: mutate only each target shape field on a passing fixture and
  require its specific diagnostic; a null amount must not accidentally prove it.
- F2 MINOR accepted: the same CLI harness must first exit 0 with correct fixtures;
  isolated errors must produce the intended diagnostic and exit 1.
- F3 optional accepted: credit packs require recurring=null; contradictory or
  missing recurring shape is refused, consistent with the malformed-data rule.

## Results

32 billing-preflight tests passed, including child-process positive/negative CLI
checks. Combined pricing, pricing-contract, payment-operations and preflight gates:
91 passed, 0 failed, 0 skipped. No application runtime or Stripe configuration was
modified. Local frontend-proxied /api/ready remained ready (database, Redis and
migrations healthy; preview background work disabled). No hosted checkout claimed.
