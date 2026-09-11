# Turning billing on

> ## 🟢 STATUS 2026-09-11 — PROVISIONED AND PROVEN. SALES DELIBERATELY CLOSED.
>
> **Everything in this file is now DONE, including §2, which was the operator
> half.** Live Stripe is fully provisioned and a real live checkout has been
> driven end to end. Money is then held behind ONE switch, on purpose: the
> launch order is *everything else proven first, money last*.
>
> | | |
> |---|---|
> | Stripe account | `acct_1TwgCrLBe83UKv9x` · live · `charges_enabled` and `payouts_enabled` true, **zero requirements outstanding** |
> | Catalogue | 10 live products + prices, `tax_behavior: inclusive`, all classified `txcd_10000000` |
> | Webhook | `we_1UETpfLBe83UKv9xKG8IZUK4`, 11 events, signing secret on the box |
> | Portal | `bpc_1UETmFLBe83UKv9xrI9qZuIZ` |
> | Account binding | `billing_account_binding` = acct_1TwgCrLBe83UKv9x / live |
> | Merchant of record | **us** — `managed_payments: { enabled: false }` on every session |
> | Statement descriptor | `XENOSYSTEM` (short `XENO`) — mirrored on `/support` |
> | Public details | trading name, support email/URL/phone/address, VAT `DE463398455` |
> | **Sales** | 🔴 **CLOSED** — `SALES_OPEN` unset. Checkout answers 503 `sales_closed` |
>
> **Proven live, not assumed:** a `credits_small` and a `pro_monthly` checkout both
> returned a `cs_live_` session and the Stripe pay page rendered (HTTP 200);
> afterwards, with the switch closed, `POST /api/billing/consent` and
> `POST /api/billing/checkout` both answer **503 `sales_closed`**.
>
> **To take money: §6.** Everything before it is history — kept because it
> records why each piece is shaped the way it is, and because §3–§4 are still the
> right checks to re-run after any billing change.

**Everything in this file except §2 was code, and it is done.** §2 was account
work in the Stripe dashboard plus environment variables on the box — genuinely
operator-only, because it requires the Stripe account. **§2 is now complete;**
what it describes is what was actually created.

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

## 2 · What the operator has to do — ✅ DONE 2026-09-11

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

## 6 · The sales switch — the only thing between here and revenue

Provisioning is done. Being *able* to take money and *choosing* to are different
facts, and only the second is a switch:
`src/server/middleware/salesGate.js`.

```
SALES_OPEN=true    → checkout works, money moves
anything else      → 503 sales_closed   (missing, empty, 'TRUE', '1', ' true')
```

🔴 **Fail-closed, and the asymmetry is the point.** An outage that stops sales is
recoverable; an env var that silently starts charging cards is not. Same posture
as `REGISTRATION_OPEN` and the ecosystem's signing resolver.

### To open the shop

```bash
ssh xeno-platform-001
sudo cp /mnt/projects/xeno-platform/.env /mnt/projects/xeno-platform/.env.bak-presale-$(date -u +%Y%m%d-%H%M%S)
# set SALES_OPEN=true in /mnt/projects/xeno-platform/.env
cd /mnt/projects/xeno-platform && sudo docker compose up -d backend
```

### Then PROVE it, in this order

```bash
# 1. the value actually reached the container — NOT a grep of .env
sudo docker exec xenostudio-backend printenv | grep SALES_OPEN     # → SALES_OPEN=true

# 2. the public config agrees
curl -s https://xenostudio.ai/api/billing/config | grep -o '"salesOpen":[a-z]*'
```

Then buy one real thing with a real card, confirm the plan lands in
`xeno_account_plans`, and refund it — `charge.refunded` is handled, so the refund
exercises the clawback path too.

🔴 **`.env` ALONE IS NOT ENOUGH.** docker-compose reads `.env` for `${}`
**substitution** only; a variable not also listed in the service's `environment:`
block reaches no container. That gap silently disabled `REGISTRATION_OPEN`,
`RESEND_API_KEY` and all five `STRIPE_*` keys on 2026-08-24, and every one of
them degraded to a plausible-looking state rather than an error. `SALES_OPEN` is
forwarded in `docker-compose.yml` — keep it there. **Verify with `docker exec
printenv`, never by reading `.env`.**

### To close it again

Unset it (or set anything else) and restart. Reversible in one line, which is
exactly why it is an env var and not a code change.

### What the switch deliberately does NOT close

| Stays open | Why |
|---|---|
| Billing **portal** | how a customer cancels, updates a card, downloads invoices. Trapping paying customers to stop new sales is a worse outcome than the one being prevented |
| **Webhook** | Stripe retries for days. An in-flight payment must still settle, grant its credits and send its receipt |
| Spending credits already bought | they were paid for |

Pinned by `scripts/sales-gate.test.mjs`, which fails if any of those get gated.

⚠️ **The gate is in the SERVICE, not on the routes, and that is load-bearing.**
Two functions create a Checkout Session and they are reached from two different
route files — `createCheckout` from `billingRoutes.js`, which has a guard, and
`createWorkspaceSeatCheckout` from `workspaceRoutes.js`, which does not. A
route-level switch would have left the **Team seat path, the most expensive item
sold, still selling with the shop shut.** The test therefore asserts the
**coverage set**: every function containing `checkout.sessions.create` must call
`assertSalesOpen()` *before* reaching the provider, so a new checkout path fails
the build until it is gated.

## What is still open after all of this

Billing being live does **not** close the download gate's other two doors. The
public CDN and the updater feed are still open, and locking them is Phase 3c —
gated on a grant-aware Hub reaching users, not on Stripe. See
`docs/DOWNLOAD-GATE.md`.

Open on the billing surface itself, none of it blocking the switch:

- **No offsite database backup has ever existed.** `R2_REMOTE` is unset, rclone
  is not installed, and the restore points sit on the same disk as the database.
  The moment the switch is flipped this stops being a hygiene item and starts
  being customer and payment records with one copy. `scripts/pg-backup.sh`
  already contains the offsite path, switched off; it needs a private bucket and
  an encryption decision.
- **`business_profile.product_description` reads unset** via the API even though
  the dashboard shows one. Stripe reports no outstanding requirements, so it is
  not blocking — but a partner review may ask.
- **Managed Payments remains available** as a different commercial arrangement
  (Stripe as merchant of record, cross-border VAT handled by Stripe). Adopting it
  would change the Impressum, the terms and who the customer contracts with — a
  deliberate decision, never a dashboard default. See `docs/TAX-POSTURE.md`.
