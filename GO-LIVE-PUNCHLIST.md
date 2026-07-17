# XENO Platform — Go-Live Punch-List (paid launch readiness)

**Created 2026-07-16.** Evidence-based readiness assessment of xenostudio.ai against the bar
"end-to-end ready to market to **paying** clients." Six critical paths probed live + in code
(read-only). Verdict per dimension, then the prioritized fix list.

> **Bottom line: NOT yet ready to market to paying clients — but the hard part is done.** The
> engine (billing, inference, auth, ledger, backups, deploy) is genuinely production-grade. What
> remains is at the *edges*: the money switch is off, the first-run screen fakes data, the
> legal/trust surface leaks + isn't DSGVO, and the marketing over-claims. ~2–3 weeks of focused
> eng + a few operator hours + a lawyer — not a rebuild.

## Scorecard

| Critical path | Verdict | One-line |
|---|---|---|
| Acquisition & marketing surface | 🟡 usable-with-gaps | Clear funnel, but broken social-share + breadth over-claims |
| **Signup → activation** | 🔴 **BLOCKER** | First screen fakes usage data; no email verify; no password reset |
| Core web apps working | 🟡 usable-with-gaps | ~8–10 real metered surfaces work; dead/mock nav siblings + "29 apps" over-claim |
| **The money path (paid gate)** | 🔴 **BLOCKER** | Stripe OFF — cannot take a euro today; go-live docs have drift |
| **Trust, security, legal** | 🔴 **BLOCKER** | Live plaintext keys served vs "Private by design"; non-DSGVO legal; no cookie consent |
| Reliability, ops & support | 🟡 usable-with-gaps | Money/auth tested + restore-proven, but nothing PAGES; single-site backups |

3 blockers, 3 fix-the-edges. None is a foundation problem.

---

## 🔴 BLOCKERS — must clear before charging money / marketing honestly

### B1 — Turn the money path on (and fix the go-live doc drift)
- **State:** `GET /api/billing/config` → `enabled:false`, all items `available:false / priceId:null`; `POST /api/billing/checkout` → 503. **Zero real euros can be taken.** The engine is excellent (idempotent webhooks, refund/dispute/dunning, hold→settle metering all live-wired) — it's just switched off.
- **Do (operator, ~½ day):** create Stripe account → 6 Products/Prices at the LOCKED EUR amounts (packs €10/€50/€100 one-time; Pro €24/mo; Team €40/seat/mo); register the webhook at `/api/billing/webhook` with **all 10 handled events** (not the 2 the doc lists); set `STRIPE_SECRET_KEY / PUBLISHABLE_KEY / WEBHOOK_SECRET` + all 6 `STRIPE_PRICE_*` (incl. **`STRIPE_PRICE_TEAM_SEAT_MONTHLY`** — missing from `.env.example`) + `BILLING_APP_URL`; provision **Stripe Tax** (`STRIPE_AUTOMATIC_TAX=true`) or EU checkout breaks; enable customer email receipts; redeploy.
- **Do (engineer, ~30 min):** fix `.env.example` (add the Team-seat price env, correct stale `$20/$60` + "monthly credits" claims) and `BILLING-SETUP.md` (list all 10 webhook events + the real "subscriptions gate features, not credits" model). Then run a **full test-mode 4242 loop** (purchase → grant → spend → refund) before flipping to live keys.
- **Why blocker:** marketing "Go Pro €24" today sends people to a 503. First live payment is unproven end-to-end.

### B2 — Fix the first-run experience (activation)
- **State:** the post-login dashboard (`src/components/overview/Overview.tsx:63-217`) is **100% fabricated, live** — a brand-new user sees 8 generations they never ran, a fake "3,750/5,000 credits used" meter, and stock Unsplash thumbnails. Plus: **no password reset** (dead `/forgot-password` link, no backend → a user who forgets is permanently locked out), **no email verification**, and the welcome-bonus modal never fires for password signups. This is why activation is ~2.5% — it's a product defect, not a traffic problem.
- **Do (~2 weeks, one full-stack owner):** replace the mock dashboard with a real empty-state + a "generate your first image" first-run CTA; wire password reset (route + endpoints + existing email template); send-on-register verification email + `/verify-email`; fix the welcome-bonus gate; collapse the credit-amount drift (register grants 50, modal says 1,000, email says 2,000 — pick one). **Prereq:** a Resend/SendGrid key + a `FREE_SIGNUP_CREDITS` decision from you.
- **Why blocker:** you cannot demo/sell a product whose first authenticated screen fabricates a usage history, and you can't run a paid account lifecycle with no password recovery or verified email.

### B3 — Close the trust/security/legal exposure
- **State (the diligence-killer):** `xenostudio.ai/env-config.js` **still serves a live Topaz key + Replicate token in plaintext** to every visitor while the homepage says "Private by design." **The fix is already committed** (repo + `dist/` are clean, HEAD `35092268`) — **production is running a stale build.** So: **redeploy the frontend from HEAD, then ROTATE both keys** (treat as compromised). Also: **no cookie-consent banner** (violates TTDSG/DDG §25 for a DE operator); the **Privacy Policy + Terms are Dec-2024 US templates on the wrong domain** (`xeno-studio.com`, dead emails, US arbitration) — not a DSGVO Datenschutzerklärung / German AGB; the Security page **claims MFA that isn't implemented**.
- **Do:** (operator, ~1–2h) redeploy → rotate keys → confirm `env-config.js` clean in prod; (1–2 days) add an opt-in consent CMP or drop analytics cookies; qualify the "never used to train" copy to what's provable; (lawyer, days) real DSGVO Privacy + German AGB with Widerrufsbelehrung + a B2B DPA (`Impressum` is already good); (product) ship TOTP MFA or remove the MFA claim.
- **Why blocker:** one curl during diligence contradicts your headline; selling to EU customers today invites an Abmahnung + Datenschutzbehörde complaint on the first paid signup.

---

## 🟡 FIX THE EDGES — before scaling traffic (not strictly blocking a first sale)

### E1 — Acquisition honesty + social share (~1–2 days, frontend)
- Ship `og-default.png` (currently **404** → every social unfurl is blank) + per-product OG images.
- Prerender a real `<head>` for `/` and `/pricing` (today they serve a bare `Xeno Studio` shell with no meta — the exact URLs you share in a launch/fundraise have no preview or SEO).
- **Honesty copy pass:** qualify "29 apps. One workspace." (catalog is 5 shipping / 9 beta / 21 coming-soon), fix Free "All apps" and Team "real-time multiplayer in Canvas" (local-only today), gate coming-soon "Open" buttons to a waitlist. **← misrepresentation risk in diligence + EU advertising law.**
- Quick wins: wire the footer newsletter (currently discards emails), fix/scope the dead Solutions menu + dead footer social links, normalize "XENO" casing.

### E2 — Scope the workspace to what works (~1–2 weeks, overlaps B2)
- The core loop is genuinely live and mature (chat + image/edit/video/audio gen + office Word/PDF + file-convert — ~8–10 metered, watermarked, entitlement-gated surfaces — *more* than earlier thought). But dead/mock siblings sit one click away with no "beta" affordance: **Search (404s), Inpainting (localhost), Video Upscale (mock), Voice (BYOK-only), Train (mock), Coding (blank), 3D Gen (broken)**. Gate/hide them.
- Point web-app "Open" CTAs at `/auth`, not `/download`.
- Verify image/video/audio gen **end-to-end with a real test account** (G-Labs asset delivery) and fix `r2_cdn: degraded (404)` in the health check.

### E3 — Ops: get alerted when it breaks (~days, mostly operator config)
- **Highest ROI, ~5 min:** paste a Healthchecks.io/BetterStack URL into `/mnt/projects/xeno-platform/.heartbeat-url` — the on-box heartbeat is already written + cron'd but no-ops without it. **Today nothing pages if the box dies at 3am.**
- Offsite backups (~1h): install rclone + set `R2_REMOTE` — backups are currently single-site (one disk loss = money ledger + all 14 backups gone).
- Error tracking (~½ day): add Sentry/GlitchTip. Status page (~1–2h): Instatus/BetterStack.
- Rotate the box GitHub PAT + set strong `POSTGRES_PASSWORD`/`REDIS_PASSWORD` (runbook exists).

---

## ✅ Already solid (the foundation is real — don't re-do it)

- **Billing engine:** idempotent crediting, refund/partial-refund clawback, dispute freeze, dunning, subscription lifecycle, advertised==charged — production-grade, just off.
- **Inference + metering:** two-phase hold→settle, 402-on-insufficient, void-on-failure, entitlement caps by plan — live-wired on all media routes. `api.xenostudio.ai/health` = `apiKeysLive:true, creditsLive:true`.
- **Auth:** password + Google/GitHub/Twitter OAuth (PKCE), JWT, bcrypt, sessions.
- **Data safety:** nightly verified `pg_dump`, 14-dump rotation, **restore round-trip tested 2026-07-14** (82 tables, 129k ledger rows matched).
- **Deploy:** git-archive, SHA-tagged, healthcheck-gated with auto-rollback.
- **CI:** money-tests + core-tests green on GitHub Actions (2026-07-15).
- **Security headers:** HSTS + nosniff + X-Frame-Options + layered rate-limiting live.
- **GDPR self-erasure:** actually built + tested (`gdprErasure.js` + `erasure.test.mjs`).
- **Impressum:** correct §5 DDG.

---

## Realistic path to "ready to market to paying clients"

1. **This week (operator hours):** redeploy from HEAD (kills the key leak + serves latest build) → rotate Topaz/Replicate → set the heartbeat URL → turn Stripe on + run the test-mode loop. Unblocks B1 + most of B3's security half + E3's top item.
2. **Weeks 1–2 (one full-stack eng):** B2 (mock dashboard → real, password reset, email verify) — this is the single biggest eng chunk and overlaps E2.
3. **Parallel (you + a German lawyer):** DSGVO Privacy + AGB + DPA + cookie CMP (B3 legal half); honesty copy pass (E1).
4. **Then:** scale traffic. Email the ~150 existing organic signups only after B1+B2+B3 are clear.

> Founder-strategy guidance, not legal advice — engage a German Rechtsanwalt for the DSGVO/AGB
> items and an accountant for VAT before the first paid EU signup. Statuses dated 2026-07-16.
