# The download gate

**Downloading a first-party desktop installer requires a signed-in account with an
active paid plan.** Owner override, 2026-08-24, against the Layer-1 rule in
`XENO PRICING - STANDARD & LEDGER.md` §3. Layers 2 and 3 are unchanged.

> 📕 **The JOURNEY — how a person actually gets from a Download button to a file,
> and everything that is tracked along the way — is `DOWNLOAD-FUNNEL.md`.** This
> file is the *enforcement*; that one is the *flow*, and it also carries the
> honest anti-abuse layering (including the in-app licence check that no product
> implements yet).

## The one thing to understand

There are **three** doors to the same bytes, and they are not equally closed:

| Door | Who uses it | State |
|---|---|---|
| `/product/:slug/download/:os` | the website Download CTA | ✅ **Phase 2 — GATED, live since 2026-08-24** |
| `updates.xenostudio.ai/apps/...` | anyone with the URL; `ReleaseFeed` used to link it directly | 🔴 **still public** — Phase 3c, blocked on 3b |
| `version.json` / `latest.yml` polling | Hub + every shipped app updater | 🔴 **still public** — platform half built (3a ✅), Hub half not (3b) |

🔴 **Until Phase 3 lands, a determined visitor can still fetch an installer from the
CDN.** Gating the website is the first door, not the last one. Do not tell anyone
"downloads are closed" on the strength of the route gate alone.

That ordering is deliberate, not laziness: locking the CDN first would kill the
updater in every copy of Hub already installed, because those binaries poll a
hardcoded public URL. Hub has to learn to ask for a grant *before* the door shuts.

## Proven in production, 2026-08-24

Not asserted from a build log — walked against `https://xenostudio.ai` with a real
account, in both directions:

| Step | Result |
|---|---|
| anonymous `curl` (`Accept: */*`) | **401** `download_grant_required` |
| anonymous browser navigation (`Accept: text/html`) | **302 → `/login?returnUrl=%2Fproduct%2Fhub%2Fdownload%2Fwin`** |
| forged grant | **401** |
| `POST /api/downloads/grant` with no token | **401** |
| fresh **free** account mints | **403** `plan_upgrade_required`, `currentPlan: free`, `requiredPlan: pro` |
| same account on **internal** mints, then follows | **302 → `…/apps/hub/v0.11.5/XENO-HUB Setup 0.11.5.exe`** |
| that installer actually resolves | **206**, 140,966,210 bytes |
| the Hub grant replayed against `pixel` / `hub-linux` / a pinned version | **`wrong_artifact`** on all three |
| plan revoked, **same token** retried | **403** again |

That last row is the one worth keeping: the entitlement is re-checked per mint
against the live plan, so it is not baked into the session token. Revoking a plan
closes the door immediately rather than at the next sign-in.

## What enforces it

- `PLAN_ENTITLEMENTS.<plan>.canDownload` in `src/server/services/billingService.js`
  — `false` on `free`, `true` on `pro` / `team` / `studio` / `internal`.
- `FREE_ENT.canDownload = false` in `src/server/utils/entitlementGate.js` — the row
  every paying customer resolves to during a database fault. Fails closed.
- `requireEntitlement` maps `canDownload` to the `general` UpgradePrompt context:
  the honest answer to a refused download is "get a plan".

Refusals name `pro`, because `cheapestPlanWith('canDownload')` walks the sellable
ladder only. `free` and `internal` are deliberately not on it.

## Walking it before Stripe exists

No plan is purchasable yet, so the happy path needs a staff account:

```bash
# On xeno-platform-001, inside the backend container. DRY RUN by default.
node scripts/grant-internal-plan.mjs you@example.com
node scripts/grant-internal-plan.mjs you@example.com --confirm
node scripts/grant-internal-plan.mjs you@example.com --revoke --confirm
```

It refuses to overwrite an account already holding an active paid plan — that row
may be a real Stripe subscription and the script cannot put one back.

## Phase 3 — the updater door

### 3a · The platform half — ✅ BUILT

`GET /api/updates/:slug/grant?os=win[&version=…][&channel=beta]`, mounted behind
`databaseMiddleware + authMiddleware`, asserting `canDownload` **before** it looks
a release up. Returns the resolved version *and* a grant in one authenticated
call:

```json
{ "version": "0.11.5", "channel": "stable",
  "filename": "v0.11.5/XENO-HUB Setup 0.11.5.exe",
  "url": "/product/hub/download/win/0.11.5?grant=…", "expiresInSeconds": 300 }
```

**Why it is not just `POST /api/downloads/grant`.** Two reasons, and the second is
the one that matters.

1. It *resolves* as well as mints. A browser already knows the version because the
   page rendered it; an updater does not. Making it fetch `version.json`
   unauthenticated first would mean *"an update exists"* is public while the bytes
   are not — two sources of truth for one decision.
2. 🔴 It keeps **update** and **download** separable. *"May this account install our
   software"* and *"may this account receive a **security fix** for software it
   already installed and paid for"* are not obviously the same permission, and the
   second is exactly the kind of question a company gets wrong by never asking it.
   Both check `canDownload` today because nobody has decided otherwise; the seam is
   the `UPDATE_CAPABILITY` constant, so splitting them later is one line plus a row
   in `PLAN_ENTITLEMENTS`, not a refactor. A gate pins that seam open.

The grant is bound to the **resolved** version, never to an empty "latest" — a
latest-shaped grant held across a release still verifies, against different bytes
than the updater decided to install.

### 3b · The Hub half — ⛔ NOT BUILT, and blocked on another session

Hub must call this endpoint and download through the returned URL instead of
polling the public CDN. That is `xeno-hub` work, and as of 2026-08-24 that repo
has a **live session** (uncommitted Agent UI changes, `main` two hours old), so
per Parallel Development Protocol §5 nothing was written into that tree.

What Hub needs to change, so whoever picks it up does not have to re-derive it:

- `build.publish.url` currently points at the public CDN and is **compiled into
  `resources/app-update.yml`**, so it cannot be corrected server-side. Changing the
  updater's source is a *release*, not a config push.
- electron-updater resolves a feed and then fetches the URLs inside it. Those are
  absolute R2 paths in a **static** file, so a grant can never live in the feed —
  it expires in five minutes. Hub needs a provider that mints per-download.
- Hub already holds an account token (`@xeno/account`), which is the whole reason
  this is possible at all.

### 3c · Locking R2 — ⛔ MUST NOT HAPPEN YET

🔴 **The order is causal, not a preference.** Every installed copy of Hub, Pixel,
Motion, Canvas, Browser, Workflow, Shell and Agent polls a hardcoded public URL.
Locking the bucket before a grant-aware Hub has actually *reached users* does not
make those installs ask nicely — it kills their updater silently, which is the
2026-08 "auto-update had been dead for three releases" failure with a bigger blast
radius.

The exit condition is a measurement, not a date: a grant-aware Hub is published
**and** the installed base has largely moved to it. Until then this door stays
open and the honest description of the gate is *"the website is closed"*.

## Release-runbook check

Anonymous must NOT receive an installer:

```bash
curl -sI https://xenostudio.ai/product/hub/download/win   # expect 401/redirect-to-auth, NOT 302-to-installer
```

⚠️ Read the **body**, not the status code. This SPA answers `200` with an empty
shell for routes that do not exist, so a status check alone proves nothing.

## Out of scope

The npm packages (`@xenosystem/agent-cli`, `agent-sdk`, `acp`, `anima`) are
published at €0 on public npm and are immutable. They stay free.
