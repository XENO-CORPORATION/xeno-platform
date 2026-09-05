# Checkout price agreement at runtime

Status: Tier 2, implemented and locally verified; 2026-09-04. Not deployed.

## Contract and evidence

New personal/credit-pack and workspace-seat purchases must verify the configured
Stripe Price against the canonical catalog before customer or checkout creation.
An unverifiable/mismatched price refuses the purchase rather than trusting a prior
manual preflight. Existing paid accounts, webhook fulfillment and renewal handling
are unchanged.

BASELINE (corrected by execution below): billingService.js createCheckout and
createWorkspaceSeatCheckout attempt offer eligibility and validate consent, then call getOrCreateCustomer and
stripe.checkout.sessions.create without retrieving or validating the Price.
KNOWN: priceAgreement.js already implements catalog amount/currency/shape checks;
billing-preflight.mjs invokes it only manually. livePriceFor caches display amounts
for five minutes and cannot supply fresh purchase validation.
KNOWN: billingRoutes.js checkout handler preserves error status/message, and both
checkout producers use consent-bound Stripe idempotency keys.
INFERRED: deployment without manual preflight currently permits an incorrect
configured Price to reach a new purchase.
UNKNOWN: target provider configuration and hosted delivery; not measured here.

## Scope, interfaces and decisions

Add one private async price guard in billingService.js, shared by both producers.
It retrieves the exact server-selected priceId with a 10-second request timeout
and zero retries, plus an independent 10-second wall-clock guard deadline, and
reuses priceIssues({...item,currency:CURRENCY}, price).
No independent currency conversion, price table, new schema or frontend styling.
The 10-second named bound limits dependency waiting; lowering it refuses more
slow-provider purchases, raising it delays feedback. Every attempt checks fresh;
the display cache is not an authorization cache.

Lenses: money, dependency failure, compatibility and diagnostics. No auth changes,
ledger changes, tax policy, deployment or existing subscription repricing.
Public display availability is not made a guarantee of checkout success: the
purchase attempt remains authoritative, including failures after a cached display.

## Invariants and checks

1. Both producers call the guard after consent validation but before customer SQL,
   customer creation, checkout creation or consent consumption. Negative service
   tests assert zero such downstream effects.
2. Missing Stripe, lookup error/timeout and every priceIssues mismatch reject with
   status 503, code billing_price_unavailable and a fixed safe user message.
   No raw provider errors or prices appear in that error. Tests inject a sentinel.
3. Each attempt performs a fresh exact-ID retrieval. A passing display-cache entry
   never authorizes checkout after a price changes. Test prime catalog, mutate
   provider response, then attempt purchase; verify refusal and new GET.
4. Valid pack/monthly/annual/Team items continue with original quantity, metadata,
   return URL and consent idempotency keys. Test actual service functions with
   synthetic provider/consent/SQL boundaries, not a replacement service.
5. Tests run without production env, network, external payment or database writes.
   Existing pricing/preflight/payment/effective-plan/withdrawal gates remain green.

## Failure, observability and rollback

Failures surface as the existing checkout error response; operator diagnosis uses
the read-only billing preflight. Guard error text is safe for existing route logs.
A provider can still archive a price between GET and checkout creation; Stripe's
checkout rejection remains authoritative. No guarantee is made for sessions
already created before this guard or for tax/discount effects handled by Stripe.

Implementation rollback is a scoped reversal of new hunks only, never resetting
the dirty worktree. No migrations. No production run or real checkout authorized
by this implementation slice.

## Plan and acceptance

Fresh-context falsification, implement shared guard plus two call sites, add
behavioral service tests to the default payment gate, run adjacent tests, update
launch evidence. Acceptance is all five invariants demonstrated by test output.

## Falsification and reconciliation

Fresh-context review found one MATERIAL issue, accepted: the installed Stripe
HTTP transport timeout measures inactivity, not elapsed response time. A response
that trickles can exceed it. Add a wall-clock rejection race with timer cleanup
and safe handling of the losing provider promise; test never-settling and late
provider rejection with a controlled timer. This bounds the purchase attempt,
not transport resource lifetime; the outstanding read-only GET has the SDK's
inactivity timeout and cannot trigger purchase effects after refusal.

Compatibility: CI uses Node 20/22, so import interception tests use module.register,
not the newer registerHooks API. Repair the prior preflight fixture accordingly.

Execution finding: the existing producers reference undefined isOffered instead
of the real isOfferable catalog predicate. The earlier KNOWN that eligibility
was validated was false at runtime. Repair both references to the existing
predicate, with behavior tests for retired/legacy prices and Team personal-path
refusal. This restores the intended eligibility contract, not a new offer policy.

### Verification

- INV-1/2: reject and consent service scenarios prove both producers stop before
  customer SQL/provider mutations and consent consumption; safe 503 on bad fields,
  missing provider, lookup exceptions and absent Price.
- INV-3: cache scenario primes real getPublicCatalog, then changes the provider;
  both stale display and previous successful checkout cannot authorize a retry.
- INV-4: valid scenario covers packs, monthly/annual personal and Team checkout,
  preserving quantity, workspace metadata, return origin and idempotency.
- INV-5: child processes receive synthetic-only env and provider/SQL boundaries.
  Seven service scenarios plus adjacent gates: 122 passed, 0 failed, 0 skipped.
  Full default npm test: exit 0. Node 20.20.2 checkout/preflight: 39 passed, 0 skipped.
- Deadline scenario asserts the 10,000ms timer with controlled time, never-settling
  provider and late rejected read: caller refuses, timer clears, no unhandled
  rejection and no delayed purchase effects.
- Offers scenario proves legacy and non-offered prices refuse, personal Team
  refuses, and the existing founding/list switch still admits the correct price.

Deviation: repaired the pre-existing undefined isOffered call discovered by the
actual service tests. No change to catalog eligibility policy. Existing source
regex assertion now names the real predicate and behavioral coverage prevents a
matching string from being mistaken for a callable implementation again.

No hosted checkout or target deployment qualification. Preview health remained
ready; its backend was not restarted, preserving the user's current session.
