# @xenosystem/licence

The main-process entitlement check every XENO desktop app runs. It answers the door's question
for one product (`XENO AUTH - AUTH GATE DELTA.md` §9):

| result | meaning | the door shows |
|---|---|---|
| `licensed` | allowed, verified or within 14-day grace | the app |
| `unlicensed` | the server was reached and said no (`reason`: `unauthenticated`, `plan_required`, …) | sign-in, or "needs a plan" |
| `expired-offline` | grace ran out and the server is still unreachable | "couldn't confirm your plan" |
| `update-required` | this build is below the supported floor — asked even when signed out | "update to continue" |

**Fail open on a network error, closed on an explicit refusal.** A timeout or a 5xx never revokes
anyone within grace; a 401/403 does, immediately.

## Use

```ts
import { startLicence, xenoClientHeaders } from '@xenosystem/licence'

const licence = startLicence({
  product: 'canvas',
  version: app.getVersion(),
  getToken: () => account.getAccessToken(),   // null when signed out
  readCache: () => store.get('licence'),
  writeCache: (l) => store.set('licence', l),  // persist atomically
  onChange: (l) => pushToDoor(l),
})
// licence.refresh() after sign-in / sign-out; licence.stop() on quit.
```

🔴 **Send `xenoClientHeaders(product, version)` on EVERY request to the platform, including your
OIDC token requests.** The server refuses a product's own sign-in client below its floor unless
this header says the build is supported. A product that sends it only on the licence check locks
itself out of sign-in the day a floor is set.

The default origin is `https://xenostudio.ai`. **Not** `api.xenostudio.ai` — that is the inference
gateway, which does not serve these routes.

## What it does not do

It stops casual copying. It does not stop a patched binary, and no client-side check ever has.
The durable protection is server-side: sign-in, sync, the agent and inference are refused to
builds below the floor.

Contract: `xeno-platform/docs/LICENCE-ENFORCEMENT.md`.
