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

## `@xenosystem/licence/door` — the sign-in door, in every app's main process

One door for every XENO desktop app (owner, 2026-10-25: one unified core, never a copy per app). Extracted from XENO
Canvas, the reference implementation of `XENO APP ENFORCEMENT - PLAYBOOK.md`: the OIDC session (loopback + system
browser, PKCE, DPoP-bound tokens, refresh token in the OS keystore only), the door state pushed to every window
(`auth-gate:state`, rendered by `@xenosystem/blocks/auth`), the licence verdict, `<userData>/auth.log` (never a
credential) and `X-Xeno-Client: <product>/<version>` on every platform call including the token exchange.

The app injects its own Electron and its own vendored account SDK, so this package keeps zero dependencies:

```ts
import { app, BrowserWindow, ipcMain, shell, safeStorage } from 'electron'
import * as account from '@xeno-corporation/account'
import { createNodeDpopSigner } from '@xeno-corporation/account/node'
import { createDoor } from '@xenosystem/licence/door'

export const door = createDoor({
  product: 'pixel', productName: 'XENO Pixel', clientId: 'xeno-pixel',
  scopes: ['openid', 'profile', 'email', 'ledger', 'inference:run'],   // what the client is registered for
  electron: { app, BrowserWindow, ipcMain, shell, safeStorage },
  account: { ...account, createNodeDpopSigner },
})
app.whenReady().then(() => { door.start(); /* create windows */ })
app.on('before-quit', () => door.stop())
// signed platform calls from main: await door.platformAuthHeaders('GET', url); door.identifiedFetch(url, …)
```
