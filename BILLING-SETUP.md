# Billing — Stripe pay path setup (go-live)

The platform now has a **real pay path**: Stripe Checkout → subscription plans + the existing
hash-chained **credit ledger** (`creditLedgerV2`).

> **Monetization model — LOCKED (`XENO MONETIZATION - STRATEGY.md`): XENO sells the HARNESS, not
> credits.** The PRODUCT is the **subscription** — Free / **Pro €24** / Team (per-seat) /
> Studio-Enterprise — i.e. the tools + agents + BYOK + ACP/MCP. **Credits are demoted:** the
> ledger meters ONLY the *optional* **managed-premium** inference path (frontier / 3rd-party
> models at a 3–5× markup) + the marketplace. BYOK (user's key) and in-house `xeno-rt` cost
> €0/near-zero and need **no** credits. The credit **packs** in the CATALOG below are therefore
> an **opt-in top-up for the managed-premium path only — never the headline.** The Pricing page
> MUST lead with subscriptions; credits are a secondary "top up for premium managed models"
> affordance. Do not market or frame XENO as "buy credits."

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
3. **One-time packs** grant credits on `checkout.session.completed`. **Subscriptions**
   activate/renew the PLAN entitlements (Pro/Team **features**) on `invoice.paid` /
   `customer.subscription.*` — they grant **no** monthly credits (the locked model: subscriptions
   sell features, credit packs sell compute). Every credit grant is **idempotent**
   (`billing_events` PK guard) so Stripe redelivery never double-credits.

## Go-live checklist (needs YOU — I can't create accounts or handle keys)
1. **Create a Stripe account** at dashboard.stripe.com.
2. **Create Products + Prices** (Stripe dashboard, **EUR**) and copy each `price_…` id. They MUST
   match the authoritative `CATALOG` in `billingService.js` (advertised==charged is verified LIVE
   against the Stripe Price at checkout):
   | Item | Env var | Type | Price | Grants |
   |---|---|---|---|---|
   | Starter pack | `STRIPE_PRICE_CREDITS_SMALL` | one-time | €10 | 1,000 credits |
   | Plus pack | `STRIPE_PRICE_CREDITS_MEDIUM` | one-time | €50 | 5,500 credits |
   | Pro pack | `STRIPE_PRICE_CREDITS_LARGE` | one-time | €100 | 12,000 credits |
   | Pro | `STRIPE_PRICE_PRO_MONTHLY` | recurring / mo | €24 | Pro **features** (no credits) |
   | Team | `STRIPE_PRICE_TEAM_SEAT_MONTHLY` | recurring / mo, **per seat** | €40 / seat | Pro features + 5 seats |
   | Team (legacy flat) | `STRIPE_PRICE_TEAM_MONTHLY` | recurring / mo | €60 | optional — leave unset |
   *(Prices + grants live in `billingService.js` `CATALOG`. **Subscriptions gate FEATURES, not
   monthly credits.** Change pricing THERE, then update the Stripe Prices to match.)*
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
