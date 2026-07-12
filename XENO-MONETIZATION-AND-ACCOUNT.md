# XENO — Monetization & Account Model (CANONICAL)

**Status:** Locked v1 · **Owner:** Emilian-Vasile Cristea · **Updated:** 2026-07-08
**Source of truth:** `xeno-platform` — this file is **copied verbatim into every XENO repo**.
Do **not** fork the model per product. Every product implements *this* contract so the ecosystem
stays "one account, one wallet." Deeper strategic rationale + competitor research:
`../XENO MONETIZATION - STRATEGY.md`. Implementation status: `xeno-platform/BILLING-SETUP.md`.

> **If you are an agent working in any XENO repo:** this is how your product makes money and how
> user accounts/entitlements work. You **integrate** with the central account/billing system in
> xeno-platform — you do **NOT** build your own billing, subscriptions, or credit ledger.

---

## 0. The one-paragraph model

XENO **sells the harness, not the tokens.** A **subscription** buys the *product* (the tools, the
agentic harness, unlimited in-house inference, BYOK). **AI inference is the user's choice** via
three paths — **BYOK** (their key → €0 to us), **xeno-rt** (our own open/local models → near-zero
cost), or **managed-premium** (frontier/3rd-party via our keys → metered). **Credits are a
separate, optional, à-la-carte top-up** used *only* for managed-premium inference and the
marketplace — **never bundled into a subscription.** This yields ~80–90% software margin with zero
inference cash risk.

---

## 1. Core principle — sell the harness, BYO-everything, open/local by default

- We charge for the **product/harness** (defensible), not for reselling commodity inference.
- **BYO-everything:** BYOK (any provider key), **ACP/MCP** (any agent), and **open-source local
  models** run via `xeno-rt`. XENO never *requires* our inference or a proprietary model.
- **Honest boundary:** XENO is a harness/aggregator, **not a model provider.** We aggregate
  API-accessible models; we do **not** claim to replace exclusive no-API models (e.g. Midjourney).

## 2. What we sell (the revenue stack)

1. **Subscriptions** (primary) — product/harness access + feature entitlements + limits. ~80–90% margin.
2. **Credit top-ups** (optional, à-la-carte) — premium-inference fuel + marketplace currency. ~65% margin.
3. **Marketplace take-rate** — 15–20% on apps/plugins/agents/models, metered on the shared ledger.
4. **Enterprise / on-prem** — SSO, audit, SLA, BYO-model; custom-priced.

## 3. The three inference paths (metering follows who pays)

| Path | Who pays for inference | Metered? |
|---|---|---|
| **BYOK** (user's provider key / their own xeno-rt) | the user → **€0 to XENO** | No — fair-use rate limits only |
| **xeno-rt in-house** (open/local models) | XENO, **near-zero COGS** | No — "unlimited" under fair-use |
| **Managed-premium** (frontier/video via XENO's keys) | XENO, **real COGS** | **Yes — costs credits** (3–5× COGS markup) |

Everyday work (BYOK + in-house) is **credit-free**. Credits appear **only** when a user opts into a
managed-premium model or buys in the marketplace.

## 4. Pricing tiers (EUR, VAT-inclusive display)

Keep to **3–4 tiers** — tier sprawl kills conversion. Subscriptions gate **product features +
limits**, not credits.

| Tier | Price | What it unlocks |
|---|---|---|
| **Free** | €0 (no card) | Full workspace/harness · **in-house (xeno-rt) models on a fair-use daily limit** · BYOK · can buy credits. **Gated:** watermarked, non-commercial, standard-res, lower-priority, daily-capped, (optionally public) |
| **Pro (Founding)** ⭐ | **€24/mo** (list rises to €30 for latecomers; early users grandfathered; annual = 2 mo free) | Everything, ungated: **unlimited in-house** · watermark-off · **commercial license** · HD/4K + longer outputs · **priority** · private · all tools/agents/ACP |
| **Team** | ~€40/seat/mo | Pooled workspace, real-time collaboration, admin/roles, shared credit pool + keys, brand controls |
| **Enterprise** | custom | On-prem / BYO-model, SSO, audit ledger, SLA, DPA, higher limits |

**Free vs Pro is the funnel:** Free lets you make real things (watermarked/capped); Pro removes
every limit. The Free gates (watermark, commercial, HD, priority, unlimited, private) are the
proven conversion triggers — keep them.

## 5. Credits — separate, optional top-ups (NOT part of any subscription)

- **À-la-carte top-ups**, bought on the user's own choice. **Available to everyone** (Free + Pro) —
  the subscription gates *features*; credits are orthogonal *premium fuel*.
- **Used ONLY for:** (a) managed-premium inference, (b) the marketplace. Never for BYOK or in-house.
- **Paid top-up credits NEVER expire.** No punitive overage. No silent re-denomination.
- **1 credit = €0.01 internally**; never expose a token/compute mapping. Show only **action prices**
  ("HD image = 10 cr", "1s premium video = 12–25 cr") with a **cost preview before generate**.
- **UX rule:** NO credit counter in the everyday (BYOK/in-house) experience — a balance meter shows
  only in the premium/marketplace context. This kills "credit anxiety."
- Subscriptions grant **zero** credits. (Do not bundle a credit allowance into a plan.)

## 6. The Account System (every product integrates; xeno-platform owns it)

The account/billing/ledger is **centralized in xeno-platform**. Products **integrate**, never
reimplement. Required pieces:

1. **Entitlements / feature-gating** — resolve the user's plan (Free/Pro/Team) → gate features +
   limits (watermark, commercial, resolution, priority, in-house daily cap). One entitlement source
   of truth, read by every product.
2. **Credit balance + metering** — read the user's credit balance; meter managed-premium + marketplace
   actions against the **shared ledger** (`creditLedgerV2`), with pre-run cost estimate + spend cap.
3. **Billing/account page** — plan status · credit balance · renewal date · **Buy credits** (top-up
   store) · **Manage subscription** (Stripe billing portal).
4. **Subscription lifecycle** — react to `checkout.session.completed`, `invoice.paid`,
   `customer.subscription.updated/deleted`, `invoice.payment_failed` → flip the user's entitlement.
5. **Top-up store** — one-time credit packs via Checkout (mode=`payment`) → grant on purchase.

## 7. Integration contract (what every product consumes)

Products talk to the shared platform account/billing API on **`https://xenostudio.ai`** (backend
routes under `/api/billing/*`). Do NOT create per-product Stripe accounts, subscriptions, or ledgers.

### 7.1 The shared client — use it, don't hand-roll fetches

Every product integrates through **one shared TypeScript client**, so the whole ecosystem behaves
identically. Canonical source: **`xeno-platform/shared/xeno-account.ts`** (framework-agnostic — web,
Electron main/renderer, Node/CLI). Copy it in (or import once published as `@xeno/account`); the
product supplies only its auth-token getter.

```ts
import { createXenoAccount } from './xeno-account';

const account = createXenoAccount({
  getToken: () => localStorage.getItem('xenoos_auth_token'), // product's own token source
  // apiBase defaults to https://xenostudio.ai
});

// FREE-path gating (open/in-house models): read the plan's entitlements
const { entitlements } = await account.getEntitlements();
if (entitlements.watermark)      applyWatermark();        // Free tier
if (entitlements.maxResolution !== '4k') capResolution(); // Free = standard-res
if (!(await account.can('commercial'))) blockCommercialExport();

// PAID-path metering (managed-premium frontier models): check credits, meter on the shared ledger
if (await account.getCredits() < estimatedCost) promptTopUp();

// Send users to manage/upgrade (never build your own billing UI):
window.open(account.billingUrl, '_blank');               // → central billing/account page
```

The two paths, both mandatory in every product: **entitlements** gate the free/open path (BYOK +
in-house), **credits** meter the paid managed-premium path. Open models cost the user nothing;
premium frontier models burn credits.

**Making the inference calls — `shared/xeno-ai.ts`** (companion client): products never call a
provider (OpenAI/Anthropic/…) directly and never hold a provider key. Every chat goes through the
platform's authed, metered `/api/ai/chat`, which proxies to the private API (the single key-holder):

```ts
import { createXenoAI } from './xeno-ai';
const ai = createXenoAI({ getToken: () => localStorage.getItem('xenoos_auth_token') });
const { content, creditsCharged } = await ai.chat({
  model: 'openai/gpt-5.4',
  messages: [{ role: 'user', content: 'Summarise this.' }],
  path: 'premium',            // 'premium' meters credits · 'byok' uses the user's key · 'inhouse' = xeno-rt
});
// InsufficientCreditsError (402) → prompt top-up · BYOKKeyMissingError (400) → prompt add-key in Settings
const { credits } = await ai.estimate({ model: 'openai/gpt-5.4', messages, path: 'premium' }); // cost preview
```

### 7.2 Underlying endpoints (the client wraps these)

| Endpoint (xeno-platform) | Purpose |
|---|---|
| `GET /api/billing/config` | Public — publishable key + purchasable catalog |
| `GET /api/billing/summary` | Plan · status · **credit balance** · renewal · entitlements |
| `GET /api/billing/entitlements` | Resolve plan → feature gates + limits (free/open-path gating) |
| `POST /api/billing/checkout` | Start Checkout (subscription or credit top-up) → returns URL |
| `POST /api/billing/portal` | Stripe billing portal (manage/cancel/update card) → returns URL |
| `POST /api/billing/webhook` | Stripe → ledger + entitlement flip (idempotent) |
| **Ledger** (`creditLedgerV2`) | Meter managed-premium + marketplace usage (paid-path) |

Auth: the user's session token (Bearer) → identifies the user for entitlements + credit balance.
One account spans every product (web + desktop + mobile), one wallet, one subscription.

## 8. Trust rules (brand-critical — non-negotiable)

- **BYOK everywhere** — never locked to our inference.
- **Transparent pricing** — cost of a premium action shown *before* it runs.
- **Paid credits never expire.** No punitive overage; hard spend caps + alerts.
- **No silent re-denomination** of credits — grandfather balances, announce changes.
- **No ads on any tier.** If we ever say "unlimited," we keep it (fair-use rate limits instead of a
  sunset date).

## 9. Per-product compliance checklist

To be monetization-compliant, a XENO product must:
- [ ] Gate its features/limits by the **central entitlement** (Free vs Pro vs Team) — no local plan logic.
- [ ] Route AI through the **three inference paths**; meter **only** managed-premium (never BYOK/in-house).
- [ ] Use the **shared ledger** for any premium/marketplace metering (never a private credit system).
- [ ] Send users to the **central billing/account page** for plan + credits + manage-subscription.
- [ ] Never create its own Stripe account/subscription/webhook.
- [ ] Follow the **trust rules** (§8) in its UI (cost preview, no credit counter on everyday work).

## 10. Implementation status (xeno-platform)

- ✅ Stripe pay path → credit ledger (`billingService.js`, `/api/billing/*`, webhook, idempotent).
- ✅ Pro €24 subscription live + tested end-to-end (test mode).
- ✅ Credit ledger (`creditLedgerV2`) — hash-chained, holds, spend caps.
- ✅ **Entitlements/feature-gating** (`xeno_account_plans` + `PLAN_ENTITLEMENTS`, `GET /entitlements`) — Free/Pro/Team gates resolve + flip on subscription events.
- ✅ **Billing/account page + top-up store** (`/overview/billing`) — plan · entitlements · credit balance · Upgrade/Manage · Buy credits.
- ✅ **Subscription lifecycle webhooks** (checkout / invoice.paid / subscription.updated|deleted / payment_failed → entitlement flip).
- ✅ **Shared client** `shared/xeno-account.ts` — the one integration surface every product adopts.
- ⏳ **Per-product rollout** — each product adopts the shared client: account surface now; **feature-gates during generation after the all-inference-via-Xeno-API rework** (so we don't gate a flow that's about to change).
- ⏳ Managed-premium metering wiring + BYOK/xeno-rt routing (the inference rework).

## 11. Distribution

Canonical copy lives in **`xeno-platform/XENO-MONETIZATION-AND-ACCOUNT.md`**. It is copied verbatim
into every repo under `xeno-corporation/`. When the model changes, update the canonical copy here
first, then re-distribute. Keep this the single source of truth.

---

*Living document. The subscription sells the harness; credits are optional premium fuel; one
account, one wallet, across every product. Not legal/financial advice — confirm entity, VAT, and
instrument with a German Steuerberater + startup lawyer.*
