# CLI account routing review — 2026-10-22

Scope: XENO Agent CLI startup and browser/device authorization through the XENO
account provider. Candidate source only; not a production qualification claim.

## Benchmark

- [GitHub CLI](https://cli.github.com/manual/gh_auth_login): browser/device sign-in
  with separate unattended credentials. Its documented fallback to plaintext
  credential storage is a limitation we avoid for account refresh tokens: Linux
  without a keyring retains a session only in the running process.
- [Microsoft MSAL](https://learn.microsoft.com/en-us/entra/identity-platform/msal-authentication-flows):
  distinct native-browser and device flows. Microsoft [recommends restricting
  device flow where possible](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-authentication-flows)
  because device-code phishing remains possible. XENO uses browser PKCE on a
  local terminal and device flow over SSH, with explicit registered-client and
  scope confirmation. Those controls reduce phishing risk; they cannot eliminate it.
- [Auth0](https://auth0.com/blog/implementing-the-device-authorization-flow-in-a-csharp-console-app/):
  issuer-supplied verification URI, one-time user code, and terminal polling.
  Device flow's browser cannot prove who started the remote terminal. We preserve
  the visible code and explicit approval, rather than auto-approving a signed-in browser.

Standards: [RFC 8252](https://www.rfc-editor.org/info/rfc8252/) (system browser,
loopback IP and exact callback path), [RFC 8628](https://www.rfc-editor.org/info/rfc8628/)
(device grant, expiry, denial, phishing precautions), and
[RFC 9700](https://www.rfc-editor.org/info/rfc9700/) (OAuth security practices).

## Route contract

| Step | Route / owner | Result |
| --- | --- | --- |
| Start chat | CLI `startChat` / `ensureSignedInForChat` | Canonical account session required; model keys and local models do not substitute for identity. |
| Remote terminal | CLI `runWelcomeAuthFlow` with SSH environment | Device grant in the same running process; no callback to the remote VPS's loopback address. |
| Device request | Provider `POST /api/oauth2/device_authorization` | Device code retained by CLI; user code, expiry and public verification URI returned. |
| Browser activation | `https://xenosystem.ai/activate` | Real route outside the website site gate. No access is granted by visiting it. |
| Signed-out browser | `/login?returnUrl=%2Factivate...` | Same-origin relative destination survives password/social login. |
| New account | `/signup` → `/auth/activate` → original `/activate?code=…` | Email verification preserves device authorization intent. |
| Inspect | Authenticated `POST /api/oauth2/device/inspect` | Show server-owned registered client and requested scopes. |
| Approve / decline | Authenticated `POST /api/oauth2/device/approve` or `/deny` | Separate explicit action; decline is terminal for a pending grant. |
| Poll | CLI account owner → provider `/api/oauth2/token` | Original grant and issuer remain unchanged; denial returns `access_denied`. |
| Local browser login | Public `/api/oauth2/authorize` → exact `http://127.0.0.1:<port>/callback` | PKCE/state/nonce preserved; credentials never travel in the loopback URL. |
| Piped chat | CLI simple-chat gate | Signed-out startup exits 1 before conversation output. `xeno run` retains explicit unattended credentials. |

`AUTH_FRONTEND_URL`, falling back to `XENO_SITE_ORIGIN`, controls public activation
pages. It must be an HTTPS origin. `OIDC_ISSUER` controls token identity and must
not change as a side effect of moving browser pages. Existing clients pin it.
The CLI explicitly accepts only its issuer or the pinned public account-page
origin, exact paths, HTTPS, no userinfo and no fragment. Custom issuers do not
inherit the first-party alias. Browser navigation preserves the PKCE query.

## Grade and evidence

| Criterion | Current evidence | Grade |
| --- | --- | --- |
| Separate human identity from model credentials | CLI unit checks, built piped subprocess, real Windows PTY sign-in screen | Locally verified |
| Correct remote/local flow selection | SSH selection checks; existing PKCE callback adversarial tests | Partial: fresh Linux VPS interaction pending |
| Public navigation without issuer migration | Provider request test and CLI URL/PKCE tests | Locally verified |
| Resume across login and email activation | Routing/funnel tests | Partial: real social/signup browser round trip pending |
| Explicit client consent and refusal | Real component DOM tests; provider denial/poll tests | Locally verified; disposable-DB denial race not yet qualified |
| No stale-code consent | Delayed inspection after code edit test | Locally verified |
| Secure custody and refresh | Existing account-owner design retained | Unverified for this change's fresh VPS and packaged OS matrix |
| Public immutable release and deployed protocol | Not performed for this candidate | Unverified |

**Overall: NOT ISG yet.** Source improvements and passing local checks do not
establish a complete packaged, deployed authentication flow.

## Remaining qualification, highest impact first

1. Fresh VPS device login through the public site, completion, cancellation,
   denied/expired code, relaunch with and without keyring. Moderate integration
   effort; requires an operator-approved real account interaction. No protocol rewrite.
2. Real browser password/social/new-account activation return path and local PKCE.
   Moderate test effort; retained cookies/redirects must be observed, not inferred.
3. Disposable PostgreSQL approve/deny/redeem concurrency and exact route auth/CSRF
   rejection. Moderate test effort; current provider denial test uses a query fixture.
4. Immutable package, upgrade and full TUI fixture qualification after account
   login becomes mandatory. Moderate consumer-test migration effort. Existing
   API-key-only chat fixtures now need an authenticated account fixture.
5. Publish CLI and deploy provider/frontend together only after reviewing exact
   artifacts and rollback. Existing 0.5.123 remains the installed public version.

## Beyond the standard — untested bets

The convention worth questioning is making people infer which terminal a browser
approval belongs to. Borrow a physical pairing ceremony: compare the same short
human-readable phrase in both places before approval. Don Norman's feedback lens
suggests showing the state of the same transaction on both surfaces, instead of
making the person infer completion from a spinner.

Three ideas: (1) matched terminal/browser pairing phrase, (2) live read-only auth
timeline explaining current progress, (3) one-action credential-store diagnostics.
Choose the timeline first: it improves remote diagnosis without changing the
cryptographic protocol or adding identity collection. First step: expose only
nonsecret states (waiting, inspected, approved/denied, exchanged, custody mode)
from the existing transaction. The pairing phrase requires protocol/UI design;
store diagnostics is narrower. None is implemented or claimed as a standard.
