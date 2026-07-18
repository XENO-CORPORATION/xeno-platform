# XENO — Monetization & Account Model (CANONICAL)

**Status:** 🔒 Locked **v2** · **Owner:** Emilian-Vasile Cristea · **Updated:** 2026-07-17
**Source of truth:** `xeno-platform` — this file is **copied verbatim into every XENO repo**.
Do **not** fork the model per product. Every product implements *this* contract so the ecosystem
stays "one account, one wallet." Deeper strategic rationale + competitor research:
`../XENO MONETIZATION - STRATEGY.md`. The enforcement mechanism (auth/session/tokens):
`XENO AUTH - SPEC.md`. Implementation status: `xeno-platform/BILLING-SETUP.md`.

> **If you are an agent working in any XENO repo:** this is how your product makes money and how
> user accounts/entitlements work. You **integrate** with the central account/billing system in
> xeno-platform — you do **NOT** build your own billing, subscriptions, or credit ledger, and you do
> **NOT** enforce paid features in the client (see §3 — enforcement is server-side).

> **What changed in v2 (2026-07-17):** the free/paid boundary moved from **client-side cosmetics**
> (watermark, local resolution cap — bypassable, bad UX) to **enforceability**: *Free = the tool
> (standalone, runs locally). Paid = the platform (the connected, server-side ecosystem).*
> **The watermark is removed.** A free export is clean. Piracy of the standalone tool is accepted
> (it's free anyway); the paid value lives on our servers where a cracked client cannot reach it.

---

## 0. The one-paragraph model

XENO **sells the harness, not the tokens** — but the harness has two layers. The **tool** (each app
running standalone: local editing, local files, **clean local export**, your own AI) is **free**.
The **platform** (the connected ecosystem — cloud sync, cross-app workflows, agents/automation,
collaboration, managed-premium inference, marketplace, teams) is **paid**, and it is enforced
**100% server-side**: every ecosystem call needs a valid, XENO-signed session that resolves to a
real account with a real subscription, checked in our database on every request. **AI inference stays
the user's choice** via three paths — **BYOK** (their key → €0 to us), **xeno-rt** (our own
open/local models → near-zero cost), or **managed-premium** (frontier via our keys → metered on
credits). **Credits are a separate, optional top-up** for managed-premium + the marketplace only —
never bundled into a subscription. ~80–90% software margin, zero inference cash risk, and a paywall
a cracked client physically cannot defeat.

---

## 1. The product is two layers: the Tool (free) and the Platform (paid)

| Layer | What it is | Price | Where it runs |
|---|---|---|---|
| **The Tool** | Each app **standalone** — local project editing, local files, **clean local export (no watermark)**, BYOK inference, in-house `xeno-rt` at fair-use. An island: no cloud, no cross-app, no agents, no collaboration. | **Free** | The user's machine (client) |
| **The Platform** | The **connected ecosystem** — cloud sync + multi-device, cross-app workflows (Pixel↔Canvas↔Motion↔Sound…), **agents/automation**, real-time collaboration, managed-premium inference, marketplace, team workspaces, cloud render/export. | **Paid** (Pro/Team) | **XENO servers** |

- **Free is a genuinely great local tool**, not a crippled demo. No watermark, no fake resolution
  ceiling on local work. It costs us ~€0 (BYOK/in-house), so a fat free tier is correct — it's the funnel.
- **Paid is the thing that makes XENO *XENO*:** the agent-native, connected stack. It is exactly the
  set of features that require our servers — which is why it is enforceable.
- **The conversion trigger is capability, not annoyance:** users upgrade because they *want* sync,
  agents, collaboration, cross-app, managed AI — not to remove a watermark we stamped on their work.

## 2. The free/paid boundary IS enforceability

The single rule that decides whether a feature is free or paid:

> **Does the feature require a XENO server to function?**
> **No → it's the Tool → free.  Yes → it's the Platform → paid (or metered).**

- **Server-required → paid/enforceable:** cloud storage/sync, cross-device, collaboration/multiplayer,
  agent runs, managed-premium inference, marketplace, publishing, team/workspace, cloud render.
- **Local-only → free (do not gate with cosmetics):** local editing, local files, **local export**,
  BYOK calls (the user's own key), on-device features. Gating these client-side is **security
  theater** — a patched client removes the gate in minutes.

**Retired as levers (v1 → v2):**
- **Watermark** — client-side; export-then-strip or screenshot defeats it. **Removed entirely.**
- **Local resolution / quality caps** — client-side; bypassable. Dropped for *local* work (managed
  *server-side* generation can still differ by tier — that's enforceable).

**Kept, because they are actually enforceable or are legal terms:**
- **In-house (`xeno-rt`) fair-use daily limit** — the models run on *our* servers; the server counts. ✅
- **Managed-premium access + priority** — server-side queue + metering. ✅
- **Commercial-use license** — a **legal term**, not a technical gate (honor-system for individuals,
  binding + valuable for businesses — the Adobe-style legitimacy lever). Confirm wording with a lawyer.
- **Everything in "the Platform" (§1)** — server-side by definition. ✅

## 3. Enforcement is 100% SERVER-SIDE (the anti-crack contract)

**Client checks are UX hints, never security.** A cracked/patched client can make itself *look* Pro;
it gains nothing, because the value is not in the binary — it's on servers the attacker doesn't own.

**Every ecosystem endpoint MUST, server-side:**
1. **Require a valid, XENO-signed access token** (unforgeable — the OIDC provider signs ES256/RS256;
   the client cannot mint one). See `XENO AUTH - SPEC.md`.
2. **Resolve the *real* account from the token** — never trust a client-sent identity, plan, or
   `isPro` flag.
3. **Check the *real* subscription/entitlement in the database on the request** — **auth ≠
   entitlement.** A logged-in **Free** user with a perfectly valid token must still be **402/403** on
   a paid feature.
4. **Hold zero provider secrets in the client** — all inference + keys live server-side
   (enforced: the platform is XENO-API-only; the client can't call a provider directly).

> **Threat model, stated plainly:** *"Bypass the auth" has two meanings.* Bypassing the **client's**
> check → worthless (you get the free local tool you already had). Bypassing the **server's** check →
> impossible without a real paid account, because the server independently verifies a signed token +
> a DB subscription on every call. **Crack the app all you want; the ecosystem stays locked.**

**What this does NOT stop (be honest):**
- **Account sharing** — one real paid account, credentials handed to friends. A *Netflix* problem, not
  a *crack* problem; mitigate later with device registration + concurrent-session limits, not with
  client hardening. (Roadmap, not launch-blocking.)
- **Piracy of the free standalone tool** — accepted on purpose. It's free, it's the funnel, and
  defending a free local binary costs more than it's worth.

**Discipline:** this holds only if it holds on **every** endpoint. Miss server-side entitlement on one
ecosystem route and that one feature leaks. Every new ecosystem endpoint ships gated (§12 checklist).

## 4. Core principle — sell the harness, BYO-everything, open/local by default

- We charge for the **product/harness + the connected platform** (defensible), not for reselling
  commodity inference.
- **BYO-everything:** BYOK (any provider key), **ACP/MCP** (any agent), and **open-source local
  models** via `xeno-rt`. XENO never *requires* our inference or a proprietary model.
- **Honest boundary:** XENO is a harness/aggregator, **not a model provider.** We aggregate
  API-accessible models; we do **not** claim to replace exclusive no-API models (e.g. Midjourney).

## 5. What we sell (the revenue stack)

1. **Subscriptions** (primary) — the **connected platform** + feature entitlements + higher limits +
   commercial license. ~80–90% margin.
2. **Credit top-ups** (optional, à-la-carte) — managed-premium-inference fuel + marketplace currency.
   ~65% margin.
3. **Marketplace take-rate** — 15–20% on apps/plugins/agents/models, metered on the shared ledger.
4. **Enterprise / on-prem** — SSO, audit, SLA, BYO-model; custom-priced.

## 6. The three inference paths (metering follows who pays)

| Path | Who pays for inference | Metered? |
|---|---|---|
| **BYOK** (user's provider key) | the user → **€0 to XENO** | No — fair-use rate limits only |
| **xeno-rt in-house** (open/local models) | XENO, **near-zero COGS** | No — "unlimited" under a fair-use daily cap (server-counted) |
| **Managed-premium** (frontier/video via XENO's keys) | XENO, **real COGS** | **Yes — costs credits** (3–5× COGS markup) |

Everyday work (BYOK + in-house) is **credit-free**. Credits appear **only** when a user opts into a
managed-premium model or buys in the marketplace. All three run **through the XENO API** — the client
never calls a provider or holds a key (§3.4).

## 7. Pricing tiers (EUR, VAT-inclusive display)

Keep to **3–4 tiers** — tier sprawl kills conversion. Subscriptions gate **the platform + limits**,
**not** credits, and **never** a watermark.

| Tier | Price | What it unlocks |
|---|---|---|
| **Free** | €0 (no card) | **The full standalone Tool** on every app — local editing, local files, **clean export (no watermark)**, BYOK, in-house `xeno-rt` at a fair-use daily cap · may buy credits for managed-premium. **Not included:** the Platform (cloud sync, cross-app, agents, collaboration, teams, priority), commercial license. |
| **Pro (Founding)** ⭐ | **€24/mo** (list rises to €30 for latecomers; early users grandfathered; annual = 2 mo free) | **The whole connected Platform:** cloud sync + multi-device · cross-app workflows · **agents/automation** · managed-premium priority · **commercial license** · higher/"unlimited" in-house · private cloud projects · all tools/ACP/MCP |
| **Team** | ~€40/seat/mo | Everything in Pro + pooled workspace, **real-time collaboration**, admin/roles, shared credit pool + keys, brand controls |
| **Enterprise** | custom | On-prem / BYO-model, SSO, audit ledger, SLA, DPA, higher limits |

**Free → Pro is the funnel:** Free lets you make real things *on your machine*; Pro connects you to
the ecosystem (sync, agents, collaboration, cross-app, managed AI) and grants the commercial license.
Every Pro lever is **server-side-enforceable** — that is the point.

## 8. Credits — separate, optional top-ups (NOT part of any subscription)

- **À-la-carte top-ups**, bought on the user's own choice. **Available to everyone** (Free + Pro) —
  the subscription gates *the platform*; credits are orthogonal *premium fuel*. (Metering is
  server-side → enforceable even on Free.)
- **Used ONLY for:** (a) managed-premium inference, (b) the marketplace. Never for BYOK or in-house.
- **Paid top-up credits NEVER expire.** No punitive overage. No silent re-denomination.
- **1 credit = €0.01 internally**; never expose a token/compute mapping. Show only **action prices**
  ("HD image = 10 cr", "1s premium video = 12–25 cr") with a **cost preview before generate**.
- **UX rule:** NO credit counter in the everyday (BYOK/in-house) experience — a balance meter shows
  only in the premium/marketplace context. This kills "credit anxiety."
- Subscriptions grant **zero** credits. (Do not bundle a credit allowance into a plan.)

## 9. The Account System (every product integrates; xeno-platform owns it)

The account/billing/ledger is **centralized in xeno-platform**. Products **integrate**, never
reimplement. Required pieces:

1. **Entitlements / feature-gating** — resolve the user's plan (Free/Pro/Team) → decide which
   *platform* features to expose. **The client gate is a hint; the server gate is the truth** (§3).
2. **Credit balance + metering** — read balance; meter managed-premium + marketplace against the
   **shared ledger** (`creditLedgerV2`), with pre-run cost estimate + spend cap.
3. **Billing/account page** — plan status · credit balance · renewal date · **Buy credits** ·
   **Manage subscription** (Stripe billing portal).
4. **Subscription lifecycle** — react to `checkout.session.completed`, `invoice.paid`,
   `customer.subscription.updated/deleted`, `invoice.payment_failed` → flip the user's entitlement.
5. **Top-up store** — one-time credit packs via Checkout (mode=`payment`) → grant on purchase.

## 10. Integration contract (what every product consumes)

Products talk to the shared platform account/billing API on **`https://xenostudio.ai`** (routes under
`/api/billing/*`). Do NOT create per-product Stripe accounts, subscriptions, or ledgers.

### 10.1 The shared client — use it, don't hand-roll fetches

Every product integrates through **one shared client** (canonical `@xeno/account`; today
`xeno-platform/shared/xeno-account.ts`; unified per `XENO AUTH - SPEC.md`). The product supplies only
its auth-token getter.

```ts
import { createXenoAccount } from './xeno-account';

const account = createXenoAccount({
  getToken: () => localStorage.getItem('xenoos_auth_token'), // product's own token source
});

// The client gate is a UX hint (hide/disable platform features you can't use):
const { entitlements } = await account.getEntitlements();
if (!entitlements.cloudSync)  hideCloudSyncUI();     // Free = standalone; Platform features hidden
if (!(await account.can('agents'))) showUpgradeCTA('agents');

// …but the SERVER re-checks on the actual ecosystem call. A cracked client that un-hides the button
// still gets 402/403 from the server (§3). Never treat the client gate as enforcement.
window.open(account.billingUrl, '_blank');           // → central billing/account page
```

**Making inference calls — `shared/xeno-ai.ts`:** products never call a provider directly and never
hold a provider key. Every call goes through the platform's authed, metered API (the single
key-holder):

```ts
import { createXenoAI } from './xeno-ai';
const ai = createXenoAI({ getToken: () => localStorage.getItem('xenoos_auth_token') });
const { content, creditsCharged } = await ai.chat({
  model: 'gpt-5.5',
  messages: [{ role: 'user', content: 'Summarise this.' }],
  path: 'premium',            // 'premium' meters credits · 'byok' uses the user's key · 'inhouse' = xeno-rt
});
```

### 10.2 Underlying endpoints (the client wraps these)

| Endpoint (xeno-platform) | Purpose |
|---|---|
| `GET /api/billing/config` | Public — publishable key + purchasable catalog |
| `GET /api/billing/summary` | Plan · status · **credit balance** · renewal · entitlements |
| `GET /api/billing/entitlements` | Resolve plan → platform-feature gates + limits |
| `POST /api/billing/checkout` | Start Checkout (subscription or credit top-up) → returns URL |
| `POST /api/billing/portal` | Stripe billing portal (manage/cancel/update card) → returns URL |
| `POST /api/billing/webhook` | Stripe → ledger + entitlement flip (idempotent) |
| **Ledger** (`creditLedgerV2`) | Meter managed-premium + marketplace usage (paid-path) |

Auth: the user's XENO-signed session token (Bearer) → identifies the user for entitlements + balance,
and is **re-verified server-side on every ecosystem request**. One account spans every product (web +
desktop + mobile), one wallet, one subscription.

## 11. Trust rules (brand-critical — non-negotiable)

- **Free is a real tool, not nagware** — clean local export, no watermark, no cosmetic cripples.
- **BYOK everywhere** — never locked to our inference.
- **Transparent pricing** — cost of a premium action shown *before* it runs.
- **Paid credits never expire.** No punitive overage; hard spend caps + alerts.
- **No silent re-denomination** of credits — grandfather balances, announce changes.
- **No ads on any tier.** If we ever say "unlimited," we keep it (fair-use rate limits, not a sunset).
- **Enforce on the server, never the client** — client gates are hints; the server is the wall (§3).

## 12. Per-product compliance checklist

To be monetization-compliant, a XENO product must:
- [ ] Ship **the free standalone Tool with NO watermark** and no cosmetic client-side cripples.
- [ ] Treat every **Platform (server-backed) feature** as paid: gate the UI by the **central
      entitlement** *and* rely on the **server** to enforce it (auth ≠ entitlement).
- [ ] **Enforce server-side on every ecosystem endpoint:** valid signed token → real account → real
      subscription check → 402/403 if not entitled. Never trust a client `isPro` flag.
- [ ] Route AI through the **three inference paths** via the XENO API; hold **no** provider key; meter
      **only** managed-premium (never BYOK/in-house).
- [ ] Use the **shared ledger** for any premium/marketplace metering (never a private credit system).
- [ ] Send users to the **central billing/account page** for plan + credits + manage-subscription.
- [ ] Never create its own Stripe account/subscription/webhook.
- [ ] Follow the **trust rules** (§11): clean free export, cost preview, no credit counter on everyday work.

## 13. Implementation status (xeno-platform)

- ✅ Stripe pay path → credit ledger (`billingService.js`, `/api/billing/*`, webhook, idempotent).
- ✅ Pro €24 subscription live + tested (test mode); Stripe live keys pending operator.
- ✅ Credit ledger (`creditLedgerV2`) — hash-chained, holds, spend caps.
- ✅ Server-side entitlements (`xeno_account_plans` + `PLAN_ENTITLEMENTS`, `GET /entitlements`) — resolve + flip on subscription events.
- ✅ XENO-API-only enforced (2026-07-17) — zero provider keys/calls in any client; all inference server-side (the §3.4 requirement).
- ✅ OIDC provider (signed sessions) live — the unforgeable-token basis for §3. See `XENO AUTH - SPEC.md`.
- ⏳ **v2 entitlement re-map** — drop `watermark`/local-res gates; add `cloudSync`/`agents`/`collab`/`crossApp` platform gates (this doc's §1–§3).
- ⏳ **Per-product rollout** — each product ships the standalone free Tool + server-gated Platform features.
- ⏳ Device/session limits for account-sharing (§3, roadmap).

## 14. Distribution

Canonical copy lives in **`xeno-platform/XENO-MONETIZATION-AND-ACCOUNT.md`**. It is copied **verbatim**
into every repo under `xeno-corporation/`. When the model changes, update the canonical copy here
first, then re-distribute. Keep this the single source of truth.

---

*Living document, v2. Free = the standalone Tool (no watermark); Paid = the connected Platform,
enforced server-side; one account, one wallet, across every product. Not legal/financial advice —
confirm entity, VAT, license wording, and instruments with a German Steuerberater + startup lawyer.*
