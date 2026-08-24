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

Copy `clients/licence/xenoLicence.ts` and call `startLicence()` at boot.

```ts
import { startLicence } from './licence/xenoLicence';

startLicence({
  product: 'hub',                    // must match the platform slug
  version: app.getVersion(),
  getToken:  () => account.getAccessToken(),
  readCache: () => store.get('licence'),
  writeCache: (l) => store.set('licence', l),
  onChange:  (l) => mainWindow?.webContents.send('licence:changed', l),
});
```

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
