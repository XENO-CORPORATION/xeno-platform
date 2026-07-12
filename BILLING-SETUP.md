# Billing — Stripe pay path setup (go-live)

The platform now has a **real pay path**: Stripe Checkout → the existing hash-chained
**credit ledger** (`creditLedgerV2`). One-time credit packs + recurring subscriptions. This
turns xenostudio.ai from "free demos" into "can take money," and every product that spends
credits monetizes through it.

## What was built (this repo)
- `src/server/services/billingService.js` — Stripe ⇄ ledger core (checkout, portal, webhook,
  idempotent crediting).
- `src/server/routes/billingRoutes.js` — `/api/billing/*` (`config`, `summary`, `checkout`,
  `portal`) + the `stripeWebhook` handler.
- `src/server/index.js` — mounts the webhook **before** `express.json` (raw body for signature
  verification) + the `/api/billing` router.
- `src/services/billingService.ts` (frontend) + `src/pages/Pricing.tsx` — Pro/Team CTAs now do
  one-click Checkout for signed-in users.
- `src/server/package.json` — adds `stripe`. `.env.example` — Stripe config block.

**Feature-flagged:** with no `STRIPE_SECRET_KEY`, `/api/billing` returns 503 and the rest of the
platform is unaffected. It goes live the moment keys are set — no code change.

## How it works
1. User clicks **Go Pro / Start a team** (or a credit pack) → `POST /api/billing/checkout` →
   Stripe Checkout Session → browser redirects to Stripe.
2. On payment, Stripe calls `POST /api/billing/webhook` → signature verified → credits granted
   via `addGrant(pool, userId, { kind:'paid' })`.
3. **One-time packs** credit on `checkout.session.completed`; **subscriptions** credit on
   `invoice.paid` (first payment **and** every renewal). Every grant is **idempotent**
   (`billing_events` PK guard) so Stripe redelivery never double-credits.

## Go-live checklist (needs YOU — I can't create accounts or handle keys)
1. **Create a Stripe account** at dashboard.stripe.com.
2. **Create Products + Prices** (Stripe dashboard) and copy each `price_…` id:
   | Item | Type | Suggested |
   |---|---|---|
   | Credits — Starter | one-time | $10 → 1,000 cr |
   | Credits — Plus | one-time | $50 → 5,500 cr |
   | Credits — Pro pack | one-time | $100 → 12,000 cr |
   | Pro | recurring / mo | $20 → 2,500 cr/mo |
   | Team | recurring / mo | $60 → 8,000 cr/mo |
   *(Credit amounts are defined server-side in `billingService.js` `CATALOG` — change there if
   you change the pricing.)*
3. **Add a webhook** in Stripe → endpoint `https://xenostudio.ai/api/billing/webhook`, events:
   `checkout.session.completed`, `invoice.paid`. Copy the **signing secret** (`whsec_…`).
4. **Set env vars** (server `.env`): `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
   `STRIPE_WEBHOOK_SECRET`, `BILLING_APP_URL=https://xenostudio.ai`, and the 5
   `STRIPE_PRICE_*` ids. (Template in `.env.example`.)
5. **Rotate the leaked keys** — the parked `platform-client-key-exposure` issue (OpenRouter +
   hardcoded Gemini in the client bundle). Same billing/gateway surface; do this before wider
   exposure. *(I can fix the client-side exposure; you rotate the actual keys.)*
6. **Deploy:** `cd src/server && npm install` (pulls `stripe`), rebuild frontend
   (`npx vite build`), redeploy the `frontend` container (see `release-guide/`).
7. **Test in Stripe test mode** with card `4242 4242 4242 4242` before flipping to live keys.

## Verify
- `GET /api/billing/config` → `{ enabled: true, catalog: [...] }` once keys are set.
- Test purchase → Stripe test dashboard shows the payment → user's credit balance increases →
  `credit_transactions` has a `paid` grant row.

## Status
✅ Built + frontend builds clean. ⏳ **Not live** until steps 1–6 above (your Stripe keys +
deploy). Nothing here is billed until you set live keys.
