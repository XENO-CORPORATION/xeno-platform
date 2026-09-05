# XENOSYSTEM live Stripe setup

This tool plans and provisions the exact live billing resources owned by
`acct_1TwgCrLBe83UKv9x`. Running it with no arguments is offline and performs no
provider reads or writes:

```bash
node scripts/stripe-live-setup.mjs
```

The catalog is imported from `billingService.js`; legacy rows are excluded. Prices
are EUR, fixed per-unit, inclusive-tax prices. Webhook events are derived from the
service's actual switch cases. Every owned object binds the account and complete
catalog digest in metadata. Complete product, price, webhook and portal pagination
is validated before the first provider mutation and again after provisioning.
Foreign, stale, duplicated or ambiguous resources fail closed and are never edited
or deleted.

Live execution is deliberately split into two stages:

```bash
node scripts/stripe-live-setup.mjs --confirm-live --stage catalog-portal
node scripts/stripe-live-setup.mjs --confirm-live --stage webhook \
  --secret-output /absolute/owner-only/xeno-stripe-webhook.json
```

Both stages require the exact account pin, `STRIPE_EXPECTED_MODE=live`, a strict
live secret/restricted key, a strict live publishable key, and a sale-capable
account. The first stage creates missing products/prices and one portal
configuration. It prints only non-secret environment mappings. The portal allows
customer/payment updates, invoices and end-of-period cancellation; plan switching
is disabled.

The webhook stage is separate because Stripe reveals its signing secret only in
the create response. It is refused on Windows: Node's numeric file mode does not
provide a reliable owner-only ACL there. Run this stage on an operator-controlled
POSIX host with an existing real (non-symlink) parent directory. The receipt is
created exclusively with mode `0600`, reserved and fsynced before the provider
write, then atomically reused through the held descriptor for the secret. The
secret is never printed. A lost response can be recovered for one hour by replaying
the identical Stripe idempotency key; after that, an endpoint without a complete
matching receipt is a hard manual recovery condition rather than a duplicate.

No stage creates tax registrations, customers, subscriptions or payments. Existing
objects are never updated or deleted. Successful partial owned catalog/portal
resources remain and are reconciled on retry.

The result emits `STRIPE_PRICE_*` mappings and a portal configuration id. Runtime
currently creates portal sessions without passing a configuration id; wiring the
emitted id into `billingService.js` is required before this API-created portal
policy is the runtime authority. The webhook receipt contains the
`STRIPE_WEBHOOK_SECRET` value and must be copied through the approved secret-store
workflow without printing it.
