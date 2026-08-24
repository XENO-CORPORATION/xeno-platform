# Launch runbook — from here to taking money

**Do these in order.** The order is not preference: each step makes the next one
safe, and doing 6 before 3 means charging real cards under terms you have not
written.

⚠️ **Not legal advice.** Steps 1–3 produce drafts and configuration; a
Rechtsanwalt and a Steuerberater sign them off. Everything else is mechanical.

Two commands tell you where you are at any moment:

```bash
npm run compliance:preflight    # can we legally take money?
npm run billing:preflight       # will the money actually arrive correctly?
```

Both exit non-zero while something is missing. **Neither will pass today**, and
that is correct — they are the map.

---

## Step 1 — Terms of Service: add three missing sections

**Why first:** everything downstream references it, and it is the longest
lead-time item because a lawyer has to read it.

Your `src/pages/Terms.tsx` today contains **zero** occurrences of "renew",
"cancel" or "withdraw" — measured, not estimated. For an auto-renewing
subscription sold to EU consumers, all three are required pre-contractual
information.

Add three sections. Draft below; **have them reviewed**, do not ship as-is.

<details><summary>Draft — Subscription term and renewal</summary>

> Subscriptions run for the period shown at purchase (monthly or annual) and
> **renew automatically** for the same period unless cancelled before the current
> period ends. The price at renewal is the price shown on your billing page. We
> will tell you by email before any price change takes effect, and you may cancel
> before it applies.
</details>

<details><summary>Draft — Cancellation</summary>

> You may cancel at any time from your billing page, or by emailing support. Your
> plan stays active until the end of the period you have already paid for; we do
> not pro-rate the remainder. After that it does not renew and you are not
> charged again. Cancelling does not delete your account or your data.
</details>

<details><summary>Draft — Right of withdrawal (the statutory one)</summary>

> If you are a consumer in the EU you normally have **14 days** to withdraw from
> a distance contract without giving a reason.
>
> Because our software and platform are made available to you immediately, you
> are asked at checkout to request that immediate access and to confirm you
> understand that **doing so ends your right of withdrawal** for that digital
> content. We record that confirmation, and the exact wording you agreed to,
> together with the time.
>
> If you would rather keep the withdrawal right, contact support before
> purchasing and we will arrange delayed access.
>
> This is separate from our [Refund Policy](/refunds), which may be more generous
> and never less.

You also need a **Widerrufsbelehrung** and a **Muster-Widerrufsformular**
(model withdrawal instructions and form) — templates exist in § 246a EGBGB
Anlage 1/2. That is a translation-and-review job, not a drafting one.
</details>

✅ **Done when:** `npm run compliance:preflight` no longer reports the three
Terms failures.

---

## Step 2 — Privacy: name your processors

`src/pages/Privacy.tsx` does not mention **Stripe**. GDPR Art. 13 requires naming
the recipients of personal data, and a payment processor plainly is one.

Add a sub-processor list. At minimum, from what this platform actually uses:

| Processor | What it receives | Where |
|---|---|---|
| **Stripe** | name, email, billing address, card token | EU/US (SCCs) |
| **Cloudflare** | IP address, request metadata | global edge |
| **Resend** | email address, message content | EU/US |
| **Hetzner / your host** | everything stored | Germany |

Add a **lawful basis** line per purpose — contract (Art. 6(1)(b)) for the
service, legal obligation (Art. 6(1)(c)) for invoices, legitimate interest for
security logging.

✅ **Done when:** the preflight's "Privacy does not name Stripe" failure clears.

---

## Step 3 — Steuerberater: settle the VAT position

**This is the one you cannot do alone, and it gates step 4.**

Bring them these facts:

- German **Einzelunternehmen**, sole proprietor
- USt-IdNr **applied for, not issued** (your Impressum says *"ist beantragt"*)
- Selling **B2C digital services** across the EU — place of supply is the
  customer's country
- Expected volume, and whether you are under the EU-wide **€10,000** cross-border
  threshold
- Whether **Kleinunternehmerregelung (§ 19 UStG)** applies to you

Ask them exactly: **OSS registration, or not? And what do I charge until the
USt-IdNr arrives?**

⚠️ Do not guess this. Under-collected VAT is paid out of revenue you have already
spent, and it accrues from the first sale.

---

## Step 4 — Stripe: create the prices

Once step 3 has an answer.

In the Stripe dashboard create one **Price** per row, in **EUR**, matching the
catalogue exactly. Do not type the amounts from memory — run the preflight, it
prints what each item expects and refuses anything that disagrees.

| Env var | Kind |
|---|---|
| `STRIPE_PRICE_EVERYTHING_MONTHLY` / `_ANNUAL` | recurring |
| `STRIPE_PRICE_PRO_MONTHLY` / `_ANNUAL` | recurring — **founding, grandfathered** |
| `STRIPE_PRICE_TEAM_SEAT_MONTHLY` / `_ANNUAL` | recurring, per-seat |
| `STRIPE_PRICE_STUDIO_MONTHLY` | recurring |
| `STRIPE_PRICE_CREDITS_SMALL` / `_MEDIUM` / `_LARGE` | **one-time** |

🔴 **Founding and list prices must both exist at once.** Founding is
grandfathered forever, so archiving it when the list price appears breaks a
public promise to your earliest customers.

**Enable Stripe Tax** in the dashboard, then set `STRIPE_AUTOMATIC_TAX=true`.

---

## Step 5 — Stripe: the webhook

Endpoint: `https://xenostudio.ai/api/billing/webhook`, subscribed to exactly:

```
checkout.session.completed        checkout.session.async_payment_succeeded
customer.subscription.created     customer.subscription.updated
customer.subscription.deleted     invoice.paid
invoice.payment_succeeded         invoice.payment_failed
charge.refunded                   charge.dispute.created
charge.dispute.funds_withdrawn
```

⚠️ **Keys set with `STRIPE_WEBHOOK_SECRET` missing is the worst reachable state** —
worse than billing being off. Checkout succeeds, the customer is charged, no plan
is granted, and they are locked out of software they just paid for.

---

## Step 6 — Put it on the box

Edit `/mnt/projects/xeno-platform/docker-compose.yml` **surgically**, then
`up -d backend`.

🔴 **Never overwrite that file from the repo.** On 2026-08-24 exactly that
destroyed four box-only values — signup closed for everyone, forum email stopped,
extension CORS broke, and outbound mail died. The tell was every line's ending
changing. Values now live in the box's `.env` and compose reads them via
`${VAR:-}`, so a future overwrite cannot erase them — **keep it that way**.

```
STRIPE_SECRET_KEY  STRIPE_PUBLISHABLE_KEY  STRIPE_WEBHOOK_SECRET
STRIPE_AUTOMATIC_TAX=true  BILLING_APP_URL  BILLING_CURRENCY=eur
+ the STRIPE_PRICE_* set
```

Then, **inside the container**:

```bash
sudo docker cp scripts/billing-preflight.mjs xenostudio-backend:/app/
sudo docker exec xenostudio-backend node /app/billing-preflight.mjs
sudo docker exec -u root xenostudio-backend rm -f /app/billing-preflight.mjs
```

Read-only. It catches the **quiet** failure: a price env pointing at the wrong
Stripe Price does not error — because the site overlays the live amount, the page
and the charge agree perfectly and both disagree with the number you chose.

✅ **Done when:** both preflights exit 0.

---

## Step 7 — Test mode, and walk the WHOLE loop

`sk_test_` + card `4242 4242 4242 4242`.

- [ ] `/pricing` shows real prices and a live CTA (not *"Not yet purchasable"*)
- [ ] clicking a plan opens the **consent dialog**; the button stays disabled until both boxes are ticked
- [ ] checkout completes → `xeno_account_plans` row is `pro` / `active`
- [ ] a row exists in `checkout_consents` with your text and timestamp
- [ ] **`/product/hub/download/win` now 302s to the installer for that account**
- [ ] cancel → row goes `free` / `canceled` → **the same download is refused again**
- [ ] `4000 0000 0000 0341` (fails after attach) → `past_due`, **download still works**
- [ ] buy **Team** on a workspace → a workspace *member* gets `canDownload`

🔴 The last three are the point. The gate has to **open and close**, dunning must
not evict a paying customer over a card that will retry, and Team must license
the people it was bought for.

---

## Step 8 — Go live

Swap to `sk_live_`, **re-create the webhook** (the signing secret differs per
endpoint), re-run both preflights, and buy **one real plan with a real card**
before telling anyone. Refund it afterwards — `charge.refunded` is handled, so
that exercises the clawback path too.

---

## Step 9 — Only now, decide about discovery

The site is `noindex` sitewide and 198 of 218 accounts are suspended. Both are
deliberate. Lifting them is a growth decision, not a launch blocker — and it is
the right last step, because it is the only one that is hard to undo.

---

## Not on this list, on purpose

**In-app licence enforcement** (`docs/LICENCE-ENFORCEMENT.md`) is mandatory for
the products but does not gate taking money — the download gate and the version
floor already stop a non-paying user getting or running a current build. Adopt it
per product on its own schedule.

**Locking the public CDN** must wait until a grant-aware Hub has actually reached
users, or every installed app's updater dies silently.
