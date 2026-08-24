# The download gate

**Downloading a first-party desktop installer requires a signed-in account with an
active paid plan.** Owner override, 2026-08-24, against the Layer-1 rule in
`XENO PRICING - STANDARD & LEDGER.md` §3. Layers 2 and 3 are unchanged.

## The one thing to understand

There are **three** doors to the same bytes, and they are not equally closed:

| Door | Who uses it | State |
|---|---|---|
| `/product/:slug/download/:os` | the website Download CTA | ✅ **Phase 2 — GATED, live since 2026-08-24** |
| `updates.xenostudio.ai/apps/...` | anyone with the URL; `ReleaseFeed` used to link it directly | **Phase 3 — still public** |
| `version.json` / `latest.yml` polling | Hub + every shipped app updater | **Phase 3 — still public** |

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
| anonymous browser navigation (`Accept: text/html`) | **302 → `/auth?returnUrl=%2Fproduct%2Fhub%2Fdownload%2Fwin`** |
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
