# Licence enforcement — MANDATORY for every XENO desktop product

**Every XENO desktop product must check entitlement in its main process at
launch, and every product must be reachable by a version floor.** This is not
optional and not per-product discretion. A product that ships without it is a
product anyone can install and run without a plan.

Contract owner: `xeno-platform`. Server half is **live**. Client half is **one
adoption per product**.

## The three layers, and what each one is actually worth

| Layer | Stops | State |
|---|---|---|
| **Download gate** | getting the installer without a plan | ✅ live |
| **In-app licence check** | running a *copied* installer | 🔴 **per product** |
| **Version floor** | running an *old* build that predates enforcement | ✅ live |

### Adoption — 1 of 17, measured 2026-08-27

The row above says "per product" and does not say *which*, so nobody could tell whether
adoption was nearly done or had not started. It had not started.

| | products |
|---|---|
| ✅ **adopted** | `motion` (0.8.0) |
| 🔴 **not adopted** | `hub` · `canvas` · `pixel` · `sound` · `shell` · `browser` · `workflow` · `docs` · `sheets` · `slides` · `notes` · `comms` · `agent` · `architect` · `3d` · `engine` |

Every product in that second row **publishes a Windows installer today**. Re-derive both halves
rather than trusting this table:

```bash
node scripts/shipped-versions.mjs                       # from the xeno-corporation workspace root
for r in xeno-*/; do ls "$r"src/main/licence/xenoLicence.ts 2>/dev/null; done
```

⚠️ **This is a measurement, not a verdict on anyone.** The contract is young, the server half
carries layers 1 and 3 on its own, and a product that has not adopted is not therefore
unprotected — it is protected by the download gate and the version floor, which is precisely why
those two exist. What is missing is the layer that stops a *copied installer already on disk*.

🔴 **A fix to `clients/licence/xenoLicence.ts` does NOT reach any product by merging.** The file
is COPIED, deliberately (see its header), so every fix is one deliberate port per adopter. That
is the cost of the named interim, and it is the reason the EXIT below matters more than it looks:
today the cost is one port; at seventeen adopters it is seventeen, and the ones nobody ports are
the ones running the version with the bug.

**EXIT — TAKEN 2026-09-25: `@xenosystem/licence` is the package** (`clients/licence/`, ESM + CJS,
behaviour-tested over a real socket, 11 mutants killed). New adopters depend on it; `motion`'s
copy should be replaced by it rather than re-synced. Beyond the copy it fixes two things:

- 🔴 **The copied client defaulted to `api.xenostudio.ai`, which is the inference GATEWAY.** It
  does not serve `/api/billing/entitlements` (it answers with its own `401 {"error":"Unauthorized"}`)
  or `/api/client-policy` (HTML 404). A product that did not override `apiBase` read an
  explicit-looking refusal from a server that never looked at the account — i.e. every signed-in
  user fail-CLOSED to `unlicensed`. The package defaults to the platform, `https://xenostudio.ai`.
- It reads the per-product verdict (`product.allowed`, AUTH GATE DELTA §9.4) instead of the global
  `canUse`, and asks `/api/client-policy` when signed out so a too-old build is told to update
  before it is offered a sign-in the server will refuse.

🔴 **The third layer is the one that answers "what about builds already out
there?"** An installer shipped before any of this existed has no check compiled
into it, and nothing we deploy can make that binary refuse itself. But it is only
worth running because of what it can *reach*, and that is all on our side — so we
stop answering it.

It binds builds that predate it because **clients already identify themselves
without ever having been asked to**: Electron and Node set a versioned
User-Agent by default, and production logs carry `XenoCode/0.2.0`,
`XenoHarbor/0.2.0`, `XENO-HUB/0.11.5`.

## What every product must do

### 1 · Check entitlement in the MAIN process

Depend on `@xenosystem/licence` and call `startLicence()` at boot.

```ts
import { startLicence, xenoClientHeaders } from '@xenosystem/licence';

const licence = startLicence({
  product: 'hub',                    // must match the platform slug
  version: app.getVersion(),
  getToken:  () => account.getAccessToken(),
  readCache: () => store.get('licence'),
  writeCache: (l) => store.set('licence', l),
  onChange:  (l) => mainWindow?.webContents.send('licence:changed', l),
});
// licence.refresh() after sign-in / sign-out; licence.stop() on quit.
```

🔴 **Put `xenoClientHeaders(product, version)` on your OIDC token requests too.** The server
refuses a product's own sign-in client below its floor unless the header says the build is
supported (AUTH GATE DELTA §9.3). `clients/licence/xenoLicence.ts` is kept only as the record of
what products copied before the package existed.

🔴 **Main process, never the renderer.** A renderer check is a suggestion —
DevTools is one keystroke away, and anything the renderer decides can be
re-decided by whoever is looking at it.

### 2 · Send `X-Xeno-Client: <slug>/<version>` on every API call

The platform can read your User-Agent, which is what makes the floor retroactive,
but an explicit header is unambiguous and survives a UA change.

### 3 · Handle all four states honestly

| State | What the product does |
|---|---|
| `licensed` | everything |
| `unlicensed` | clearly-labelled unlicensed mode — say what is wrong and how to fix it. **Do not fake a crash and do not silently degrade.** |
| `expired-offline` | grace ran out with no contact. Say *that*, not "your licence is invalid" — it is a different fact and the person may be paid up. |
| `update-required` | this build is below the floor. **Not** a licence problem; say "update to continue" and link the download. |

### 4 · The rule implementations get wrong

🔴 **Fail OPEN on a network error. Fail CLOSED on an explicit refusal.**

*"I could not reach the server"* and *"the server said no"* are different facts.
Conflating them punishes someone on a train for something they did not do, and it
is the most common way licence enforcement becomes a support queue. **A timeout is
not a refusal.** A 5xx is *our* fault and gets the same treatment.

Grace is **14 days**. Shorter looks tidier and turns ordinary life — a long trip,
a locked-down network, a week-long ISP outage — into a support ticket.

## The version floor, for operators

Per product, default **none**. A floor is created deliberately:

```sql
INSERT INTO client_version_policy (product, min_supported, min_recommended, message, enforced_at)
VALUES ('hub', '0.11.0', '0.12.0', 'Update XENO Hub to continue.', '2026-09-15T00:00:00Z');
```

- `min_recommended` **warns** (advisory header). `min_supported` **refuses** (426).
- `enforced_at` in the future = **published but not biting** — a deprecation
  rather than an outage. Announce first.
- Refusals land in `client_version_refusals`, because *"how many people did we
  just lock out, and on which builds?"* is unanswerable at exactly the moment it
  is most urgent.

🔴 **Before raising a floor, measure who it hits:**

```sql
SELECT substring(user_agent from '[A-Za-z-]+/[0-9][0-9.]*') AS client, count(*)
FROM api_usage_logs WHERE at > now() - interval '30 days' GROUP BY 1 ORDER BY 2 DESC;
```

### 🔴 A control must never refuse the remedy it names

`/api/updates`, `/api/downloads`, `/api/client-policy`, health and logout are
**exempt from the floor**. A floor that blocks the update feed bricks the app
permanently: the user is told to update, the app asks where the update is, and we
refuse to say.

This was not theoretical — the first live test of the floor did exactly that,
because Express strips the mount path and the exemption list was written in full
paths. Every unit gate passed, because they asserted the paths were *present in
the file*. Only calling the middleware caught it.

## Honest limits

In-app enforcement stops **casual** copying — an installer handed to a colleague
will not run. It does **not** stop a patched binary or an edited cache, and no
client-side control ever has. The cache is an offline affordance, not a security
boundary; signing it would raise the effort slightly and change nothing.

**The durable protection is architectural and already true:** cloud sync, the
cross-app agent, hosted inference and collaboration are not *in* the binary, so
they cannot be cracked out of it. A patched build is a local editor with no
platform — which is the free tier it was trying to escape.

## Adoption status

| | in-app check | `X-Xeno-Client` |
|---|---|---|
| hub · pixel · motion · canvas · browser · workflow · shell · sound · docs · sheets · slides · notes | 🔴 none | 🔴 none |

`GET /api/billing/entitlements` — whose own docstring reads *"the gate every
product reads"* — was live and called by **zero** products when measured on
2026-08-24.
