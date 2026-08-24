# Turning billing on

**Everything in this file except §2 is code, and it is done.** What is left is
account work in the Stripe dashboard and six environment variables on the box —
genuinely operator-only, because it requires the Stripe account.

## Why this became urgent

Before 2026-08-24, billing off meant *we are not charging yet*. After the
download gate (`docs/DOWNLOAD-GATE.md`), billing off means **nobody can install a
XENO app** — not a customer, not a reviewer, not a prospect. `canDownload` is
false on `free`, no plan is purchasable, and the only way onto a plan is
`scripts/grant-internal-plan.mjs` run by hand on the box.

That is a deliberate, reversible state, and it is not a shippable one.

## 1 · What the code already does

| | |
|---|---|
| Checkout | `createCheckout()` → Stripe Checkout, per catalogue item, with tax fields |
| Plan grant | `handleEvent()` on `checkout.session.completed` → `setPlan(pro\|team\|studio)` |
| Renewal | `invoice.paid` / `customer.subscription.updated` → plan + `current_period_end` |
| Cancellation | `customer.subscription.deleted` → `setPlan(free, canceled)` |
| Dunning | `invoice.payment_failed` → `past_due`, which **still counts as active** so a card that fails on Monday does not lock someone out of their software on Monday |
| Refunds / disputes | `charge.refunded`, `charge.dispute.*` → credit clawback, freeze |
| Team seats | `createWorkspaceSeatCheckout()` → per-seat quantity → workspace plan |
| Advertised == charged | `getPublicCatalog()` overlays the **live** Stripe amount |
| Idempotency | `claimEventTx()` — a redelivered webhook cannot double-grant |

`CATALOG` in `billingService.js` is the single source of truth. Nothing else in
the codebase states a price, which is why there is no list of amounts here.

## 2 · What the operator has to do

### 2a · Create the Prices

One Stripe Price per env below, **in EUR**, at the amount the catalogue
advertises. Do not guess the amounts — run the preflight (§3); it prints exactly
what each item expects and refuses anything that disagrees.

| Env | Kind |
|---|---|
| `STRIPE_PRICE_EVERYTHING_MONTHLY` | recurring, monthly |
| `STRIPE_PRICE_EVERYTHING_ANNUAL` | recurring, yearly |
| `STRIPE_PRICE_PRO_MONTHLY` | recurring, monthly — **founding**, grandfathered |
| `STRIPE_PRICE_PRO_ANNUAL` | recurring, yearly — **founding** |
| `STRIPE_PRICE_TEAM_SEAT_MONTHLY` | recurring, monthly, per-seat |
| `STRIPE_PRICE_TEAM_SEAT_ANNUAL` | recurring, yearly, per-seat |
| `STRIPE_PRICE_STUDIO_MONTHLY` | recurring, monthly |
| `STRIPE_PRICE_CREDITS_SMALL/MEDIUM/LARGE` | **one-time** |

🔴 **Founding and list prices must both exist at the same time.** Founding is
grandfathered forever, so the old price cannot be archived when the list price
appears — `foundingOpen()` decides which is *offered*, and the entitlement table
resolves both to the same access. Archiving the founding price breaks a public
promise to the people who bought earliest.

### 2b · Create the webhook endpoint

`https://xenostudio.ai/api/billing/webhook`, subscribed to exactly:

```
checkout.session.completed        checkout.session.async_payment_succeeded
customer.subscription.created     customer.subscription.updated
customer.subscription.deleted     invoice.paid
invoice.payment_succeeded         invoice.payment_failed
charge.refunded                   charge.dispute.created
charge.dispute.funds_withdrawn
```

### 2c · Put six variables on the box

In `/mnt/projects/xeno-platform/docker-compose.yml`, then `up -d backend`.

🔴 **Never overwrite that file from the repo.** The live copy carries
`REGISTRATION_OPEN_UNTIL` and other lockdown values that are not all in git.
Edit it surgically.

```
STRIPE_SECRET_KEY  STRIPE_PUBLISHABLE_KEY  STRIPE_WEBHOOK_SECRET
BILLING_APP_URL    BILLING_CURRENCY=eur    (+ the STRIPE_PRICE_* set)
```

## 3 · Prove it before trusting it

```bash
sudo docker cp scripts/billing-preflight.mjs xenostudio-backend:/app/
sudo docker exec xenostudio-backend node /app/billing-preflight.mjs
sudo docker exec -u root xenostudio-backend rm -f /app/billing-preflight.mjs
```

Read-only — every Stripe call is a GET, and a test asserts it can never gain a
write. It reports a **length** for each secret, never a value.

🔴 **The quiet failure it exists to catch.** *"Stripe is off"* is loud: the config
endpoint says `enabled:false` and the pricing page says *"Not yet purchasable"*.
The dangerous one is a price env pointing at the **wrong** Stripe Price. Because
`getPublicCatalog()` overlays the live amount, the page and the charge agree
perfectly — they just both disagree with the number a human decided. Nothing
errors. The product is simply re-priced.

The comparison is a pure function (`src/server/utils/priceAgreement.js`) so the
cases that matter are unit-tested rather than discovered in production: an
archived price, a monthly price on an annual item, a **recurring credit pack**
that bills a one-off purchase every month.

⚠️ **Keys set with `STRIPE_WEBHOOK_SECRET` missing is the worst reachable state** —
worse than billing being off. Checkout succeeds, the customer is charged, no
webhook is verified, no plan is granted, and they stay locked out of the software
they just paid for. The preflight calls this out in those words.

## 4 · Test mode first

`sk_test_` + card `4242 4242 4242 4242`, and walk the whole loop, not the happy
half:

- [ ] preflight exits 0
- [ ] `/pricing` shows real prices and a live CTA (not *"Not yet purchasable"*)
- [ ] checkout completes → `xeno_account_plans` row is `pro` / `active`
- [ ] **`/product/hub/download/win` now 302s to the installer for that account**
- [ ] cancel → row goes `free` / `canceled` → the same download is refused again
- [ ] `4000 0000 0000 0341` (fails after attach) → `past_due`, download **still works**

That last pair is the point. The gate has to open *and* close, and dunning has to
not evict a paying customer over a card that will retry.

## 5 · Then live

Swap to `sk_live_`, re-create the webhook (**the signing secret differs per
endpoint**), re-run the preflight, and buy one real plan with a real card before
telling anyone. Refund it afterwards — `charge.refunded` is handled, so that
also exercises the clawback path.

## What is still open after all of this

Billing being live does **not** close the download gate's other two doors. The
public CDN and the updater feed are still open, and locking them is Phase 3c —
gated on a grant-aware Hub reaching users, not on Stripe. See
`docs/DOWNLOAD-GATE.md`.
