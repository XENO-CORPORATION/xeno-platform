# Billing reconciliation inventory

Status: local library and tests; not deployed and not a cutover procedure.

## Purpose

A Stripe key identifies an account, but changing the key does not migrate customers or
subscriptions. The runtime binding refuses an unbound database with legacy billing state.
`scripts/lib/billing-reconciliation.mjs` provides the bounded, read-only evidence needed before
designing an explicit adoption or account cutover. In particular, it finds provider subscriptions
for every customer in `billing_customers` even when the local plan row has no subscription ID.

It deliberately never reports `cutoverApproved: true`. A complete report means only that the
declared, limited inventory completed without an unknown result.

## Inputs and trust boundary

`reconcileBilling` accepts:

- an injected Stripe client using the same secret represented by the explicit expected account and
  `test`/`live` mode;
- the four mandatory billing environment pins accepted by `billingAccountConfig`;
- an injected `readSnapshot` function;
- bounded page and request limits.

`readBillingReconciliationSnapshot` is the PostgreSQL adapter. Its caller supplies a dedicated,
already-connected client and remains responsible for releasing it. The adapter opens a
`REPEATABLE READ READ ONLY` transaction, applies ten-second statement and lock timeouts, reads only
a fixed source-owned table/predicate list, and always rolls back. It performs no DDL and no binding
adoption.

Provider reads use a ten-second deadline and zero network retries. The current Stripe account is
verified before database/provider inventory and again at the end. Every mapped customer is read,
then all pages of its subscriptions (`status=all`), PaymentIntents and Checkout Sessions are read.
Malformed lists, duplicates, unknown states, mismatched customer/mode, pagination exhaustion,
request exhaustion, account drift, missing/deleted customers and transport failures all keep the
report incomplete.

## Redaction and interpretation

The report exposes only aggregate counts, fixed issue codes, the configured mode and whether the
database binding is absent/matching/mismatched. It never returns emails, provider object IDs,
provider error messages, raw database rows, secret values or request IDs.

`obligations.unknown` is true whenever any scoped observation is incomplete. Nonterminal
subscriptions, open Checkout Sessions and unsettled PaymentIntents are counted, but zero values are
not proof that an account is safe to abandon.

The scope is explicitly `database-mapped-customers-only`. It is not an account-wide search and is
not atomic with Stripe. It does not inventory invoices, disputes, refunds, unmapped provider
customers or in-flight webhook delivery. Those limitations remain in every report. Historical
financial evidence must be preserved, and any adoption/cutover/cancellation/refund requires a
separate reviewed operation.

## Qualification

Run the hermetic tests (no network or live Stripe calls):

```powershell
node --test scripts/billing-reconciliation.test.mjs
```

The tests cover configuration and account mismatch, legacy database shape validation, read-only
transaction/rollback behavior, binding mismatch, complete pagination, active obligations,
missing/deleted customers, provider errors, malformed/duplicate/wrong-mode objects, page/request
limits, final account drift, redaction and the permanent no-approval posture.

CLI wiring should be added only through the reviewed platform qualification path. It must construct
the Stripe client and dedicated database client without logging credentials, emit only this redacted
report, and exit nonzero unless `complete` is true. Even exit zero remains inventory evidence—not a
cutover authorization.
