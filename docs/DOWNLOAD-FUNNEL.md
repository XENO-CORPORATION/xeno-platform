# The download funnel

**One intent, carried across every boundary.** A person expresses one wish — *"I
want Hub for Windows"* — and then has to cross up to four boundaries: identity,
profile, payment, entitlement. Before this, every one of them destroyed the
intent. That is why the funnel leaked, and why nobody could answer *"did this
account exist because someone wanted Pixel?"*

Companion to `DOWNLOAD-GATE.md`, which covers the *enforcement*. This covers the
*journey*.

## The flow

```
                      ┌──────────────────────────────┐
  Download button ───▶│ POST /api/downloads/intent   │  anonymous, always
                      │ → token + state + next       │
                      └──────────────┬───────────────┘
                                     ▼
                   resolve(): signin → onboarding → plan → artifact → ready
                                     │
        ┌────────────┬───────────────┼───────────────┬─────────────┐
        ▼            ▼               ▼               ▼             ▼
     /auth      /onboarding      /pricing       "no build"     302 to file
   ?returnUrl   ?next=resume     ?i=token        (honest,      (grant minted,
   &next=resume                                 pre-payment)    audited)
        │            │               │
        └────────────┴───────────────┴──▶ /download/resume?i=token ──▶ finishes
```

Every surface links back to `/download/resume?i=<token>`. That page is the state
machine's face: it re-asks on every load and does whatever is now missing.

## Why the order is what it is

🔴 **It must not be reordered for convenience.**

| Step | Why here |
|---|---|
| **signin** | Nothing can be attributed to a person we cannot name. |
| **onboarding** | Before payment, because asking someone to pay before we know what they came for wastes the one moment they are most willing to tell us — and a refund is expensive where a survey is free. |
| **plan** | Before the artifact check, because refusing on entitlement must never reveal which builds exist. |
| **artifact** | Last, because it is the only check that fails for a reason the PERSON cannot fix. *"There is no macOS build"* after payment is a refund; before payment it is honesty. |

## The one rule that keeps this safe

🔴 **An intent names a WISH, never a PERMISSION.**

It is minted before we know who anyone is, and it travels in URLs, through
Stripe, and through an OAuth round-trip via a third party. So it must be
worthless to steal. There is **no `entitled` column** and a gate forbids one;
`resolve()` re-derives everything from the live database and trusts nothing on
the row. A stolen token yields the name of a product that was public anyway.

Reading someone else's intent answers **404, not 403** — a 403 confirms the token
is real and turns the endpoint into an oracle for guessing valid tokens.

## Conversion: the button stays visible

🔴 **A logged-out visitor sees a real, enabled Download button with the real
version on it.** The instinct when adding a paywall is to hide or disable it for
people who cannot use it yet, and that is exactly backwards: it removes the thing
that makes someone want an account. **The gate belongs after the click.**

Asserted in a real browser by `npm run smoke:download-funnel`.

## What you can now answer

```sql
-- Did this account exist because of a download?
SELECT slug, os, required_signup, required_purchase, purchased_plan, referrer, utm
FROM download_intents WHERE user_id = $1;

-- The whole journey, in order
SELECT e.step, e.at, e.detail
FROM download_intent_events e JOIN download_intents i ON i.id = e.intent_id
WHERE i.token = $1 ORDER BY e.id;

-- Where does the funnel leak?
SELECT step, count(*) FROM download_intent_events GROUP BY step ORDER BY 2 DESC;

-- Which products drive signups?
SELECT slug, count(*) FILTER (WHERE required_signup) AS signups, count(*) AS attempts
FROM download_intents GROUP BY slug ORDER BY signups DESC;

-- Which purchases were caused by a download attempt?
SELECT slug, purchased_plan, count(*) FROM download_intents
WHERE required_purchase AND purchased_plan IS NOT NULL GROUP BY 1,2;
```

A real journey, captured live on 2026-08-24:

```
created              hub
signin_required      not_signed_in
signup_completed                      ← 5 s later. This account exists because of Hub.
onboarding_required  onboarding_incomplete
plan_required        no_plan
onboarding_completed
grant_minted         hub
```

## Measurement is never a dependency of the product

`record()` cannot throw into a caller, and the client falls back to a bare grant
if the funnel is unreachable. A signed-in, entitled customer must still be able to
download while analytics is down. Both are gated; the first *behaviourally*,
against a pool that throws.

## New products need nothing

The funnel is slug-generic: it reads `releases.json` for whatever slug it is
given. A product that publishes a release is in the funnel the moment it does.
There is no per-product registration, and adding one would be the thing that
rots.

## 🔴 Anti-abuse: what is real, and what is theatre

You asked for this to work "like Adobe". Here is the honest layering, because
overstating it is worse than a gap.

| Layer | State |
|---|---|
| Website download route | ✅ **closed** — grant required, artifact-bound, 5-min TTL |
| Grant audit (who took what, when, from where) | ✅ **built** — `download_grants` |
| Rate limiting on intents and grants | ✅ **built** |
| Public CDN (`updates.xenostudio.ai`) | 🔴 **open** — anyone with the URL gets the installer |
| Updater feed polling | 🔴 **open** |
| **In-app licence check at launch** | 🔴 **NOT BUILT IN ANY PRODUCT** |

**The last row is the one that actually answers your question, and it is not a
platform problem.**

Once someone has the `.exe`, the website has no say in what they do with it. That
is not a gap in this work — it is where the boundary physically is. What Adobe
actually does is not gate the *download*; it gates the *launch*: Creative Cloud
holds the licence, each app re-validates against Adobe's servers with an offline
grace period, and the server-backed features simply do not function without one.

⚠️ **The platform half of that already exists and is unwired.**
`GET /api/billing/entitlements` — whose own docstring reads *"the gate every
product reads"* — is live and authenticated. Measured 2026-08-24 across hub,
pixel, motion, canvas, browser, workflow, shell and sound: **zero of them call
it.** The single match, in `xeno-motion`, is a comment in a type declaration.

That is the *built, tested, unreachable* shape this workspace has now recorded
seven times. It is a **cross-repo requirement**, and the missing piece is one
adoption per product, not a new service.

### The contract each product must implement

In the **main process**, not the renderer — a renderer check is a suggestion.

1. On launch, call `GET /api/billing/entitlements` with the account token.
2. `canUse` false → run in a clearly-labelled unlicensed state. Do **not** fake a
   crash and do **not** silently degrade; say what is wrong and how to fix it.
3. **Cache the last good answer with a grace period** (7–14 days is the industry
   norm). A laptop on a plane must keep working. An app that bricks itself
   offline is a worse product than one that is occasionally over-generous.
4. Re-validate on a schedule, not only at launch.
5. **Fail OPEN on a network error, CLOSED on an explicit refusal.** *"I could not
   reach the server"* and *"the server said no"* are different facts, and
   conflating them punishes people with bad wifi for something they did not do.

⚠️ **Rule 5 is where implementations go wrong**, and it is worth stating in a
product's own code: a timeout is not a refusal.

### What this buys, honestly

In-app enforcement stops *casual* sharing — a copied installer that will not run
for someone with no account. It does **not** stop a determined attacker patching
a binary, and no client-side control ever has. The durable answer is the one this
platform is already built around: **the valuable half is server-side.** Cloud
sync, the cross-app agent, hosted inference and collaboration cannot be cracked
out of a binary because they are not in the binary.

That is a stronger position than Adobe's, and it comes from the architecture
rather than from obfuscation.

## Files

| | |
|---|---|
| `src/server/services/downloadFunnel.js` | the state machine — **the only place the order lives** |
| `src/server/services/releaseCatalog.js` | shared artifact lookup (funnel + route must agree) |
| `src/server/routes/downloadFunnelRoutes.js` | the anonymous surface |
| `src/lib/downloadFlow.ts` | client flow |
| `src/pages/DownloadResume.tsx` | the resume state machine, incl. the webhook wait |
| `scripts/download-funnel.test.mjs` | 30 gates, 21/21 mutations caught |
| `scripts/download-funnel-render.mjs` | `npm run smoke:download-funnel` — real browser, live site |
