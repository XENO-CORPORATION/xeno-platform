# Hosted account sign-in for a read-only local preview

Status: Local implementation authorized 2026-09-08; deployment is not authorized
Owner: XENO Platform
Created: 2026-09-08

## 1. Outcome and authority

The locally developed platform UI can display the operator's existing hosted XENO
account, with an unmistakable read-only banner. Its session cannot change projects,
settings, memberships, credits or subscriptions, even if a request bypasses the local
proxy. The isolated local database/backend remains available for mutation tests.

The user's latest approval covers implementation and local qualification. It does
not authorize a production deployment, new accounts, password changes, trust-store
changes, signup reopening, provider configuration or real transactions. No frontend
or backend code is changed by this preparation.

## 2. Evidence and limits

| Level | Finding | Reproducible locator |
| --- | --- | --- |
| KNOWN | Local candidate HEAD is `9278420998c6d0d51d43fa3aa5ebfb5472679e9f` with extensive WIP; HEAD alone is not this candidate's source | `git status --short`; `git diff -- src/server/index.js src/server/routes/authRoutes.js` |
| KNOWN | Hosted migration endpoint returned JSON 404 `Not found`; unauthenticated validation returned 401 | Credential-free preflight on 2026-09-08: `POST https://xenostudio.ai/api/auth/browser-session`, `GET /api/auth/validate`; redirects not followed |
| KNOWN | Local browser login requests cookie mode, clears its in-memory bearer and expects cookie authentication afterward | `src/services/authService.ts`, `login`, `validateSession`; `src/lib/authSession.ts` |
| KNOWN | Local BFF implementation exists but is not a reviewed deployable delta | `src/server/middleware/browserSession.js`; `src/server/routes/authRoutes.js`, `issueBrowserSession`, `issueLoginCredential`, `/browser-session`, `/refresh`, `/logout` |
| KNOWN | Cookie state joins the existing session row and cascades when that session is deleted | `src/server/database/migrations/20260903090000-browser-bff-sessions.sql` |
| KNOWN | Current local BFF sessions have no persisted read-only purpose | Same migration and `browserSessionMiddleware` |
| KNOWN | Workspace GET is not a pure read: it calls `ensurePersonalWorkspace`; selection POST persists a user preference | `src/server/routes/workspaceRoutes.js`, `GET /`, `POST /:id/select` |
| KNOWN | Account/dashboard reads can invoke lazy writes: `creditsView` calls `getBalanceV2` to seed a ledger account, and `getPlan` calls DDL through `ensureSchema` | `src/server/utils/accountViews.js`; `src/server/services/billingService.js`, `getPlan`, `ensureSchema` |
| KNOWN | The Vite proxy disables upstream certificate verification, has more-specific external proxies, and logs request URLs | `vite.config.ts`, `server.proxy` |
| KNOWN | Web OIDC registration is exact-match to hosted callback URLs, not generic loopback | `src/server/database/migrate-oidc-clients.js`, `FIRST_PARTY_CLIENTS` entry `xeno-web` |
| UNKNOWN | Exact active production image/source revision, schema, cookie-mode login behavior and existing-client cohorts | Read-only target inventory and immutable source/image comparison before extraction |
| UNKNOWN | Browser acceptance and trusted certificate availability for the dedicated local origin | Local TLS/browser qualification before accepting credentials |

The 404 proves that this endpoint was not reachable; it does not independently prove
that every hosted cookie-login path is absent. Before choosing the production delta,
inspect the active image/source and test the complete candidate contract in isolation.
Do not create an account or submit guessed credentials to infer support.

The root `XENO AUTH - SPEC.md` is the authentication authority. The two August 27
ecosystem execution/inventory briefs referenced by the auth skill remain absent;
this specification does not replace them or declare ecosystem auth conformance.

## 3. Chosen approach

Use the existing origin-owned browser-session mechanism, adding a restrictive
preview session purpose. Do not build a token-paste flow, copy production secrets
into the browser, borrow another product's OAuth client ID, or introduce a second
password verifier. There are two independently tested enforcement layers:

1. **Hosted session policy:** stored purpose and exact operation allowlist; authority
   follows the session, not a caller-controlled header.
2. **Local preview guard:** fixed HTTPS upstream, loopback-only listener, strict
   Host/Origin checks, explicit request allowlist and browser egress restrictions.

Deploying the currently missing bridge endpoint alone is insufficient. The ordinary
BFF session is full-account authority, and GET alone does not establish read-only behavior.

## 4. Scoped source changes

Extract onto a clean branch based on a verified production-compatible baseline.
Never release the dirty worktree wholesale or use the dirty-deploy override.

| Boundary | Intended change |
| --- | --- |
| Session schema | Include the existing additive BFF migration if absent; add a new migration for preview purpose and absolute expiry, using a fresh migration ID at implementation time |
| `browserSession.js` and shared auth boundary | Resolve preview sessions; enforce persisted restrictions before handlers; reject ambiguous credential combinations and prevent alternate auth routes from upgrading authority |
| `authRoutes.js` | Explicit preview-cookie login for existing accounts, purpose-preserving refresh and this-session logout; no raw token return; preserve existing standard-client behavior |
| `index.js` | Wire policy before every relevant route and upgrade path; schema readiness before traffic; do not drag unrelated server changes into the candidate |
| `accountViews.js`, billing/ledger read helpers | Add true read-only projections over existing data; no request-time DDL, bootstrap grant or lazy account creation for preview reads |
| `workspaceRoutes.js` | For preview sessions, list only existing memberships/workspaces; never run personal-workspace creation |
| `WorkspaceContext.tsx` | Preview selection is a locally held choice among server-confirmed memberships; do not call the durable selection POST or claim that preferences were saved |
| New preview policy/launcher plus `vite.config.ts` | Dedicated guarded mode; do not change the existing isolated launcher or default production configuration |
| Login/session bootstrap | Recognize preview cookie/CSRF names, display verified mode, disable unqualified signup/social/recovery/write paths with an explanation |

These are intended paths, not a ready-to-deploy file manifest. A source diff and
dependency closure must be produced against the verified target before release approval.

### Compatibility must be explicit

- Current hosted clients that omit cookie mode keep their existing contract during
  the compatibility window. Do not copy local `issueOAuthCredential` wholesale:
  its default cookie-only web return may strand a hosted UI expecting the old return.
- Password sign-in with the real account is the first qualified path. An account
  without a password is not reset or given a synthetic password to pass this gate.
- Social sign-in remains a requirement with a separate exit gate: provider state
  must bind preview purpose and an explicitly registered callback. Until qualified,
  the preview explains that social sign-in is unavailable. It must not redirect to
  an unrestricted hosted application and call that successful local sign-in.
- The token-migration bridge is not needed to start a new preview session and is
  denied to an existing preview session. No legacy full-scope token import.

## 5. Session and transport contract

- Proposed request mode: `X-Xeno-Session-Mode: preview-readonly`. Only the trusted
  preview proxy sets this upstream; it overwrites caller input. Login still verifies
  credentials at the existing XENO origin and existing rate/suspension gates apply.
- Extend `browser_session_state` additively with `purpose` (`standard` or
  `preview_readonly`) and `absolute_expires_at`. Existing rows become `standard`.
  New preview sessions have a 60-minute absolute lifetime; refresh rotates secrets
  without extending the cap or losing purpose. This lifetime is a named tunable,
  bounded by the server, not an unrestricted client parameter.
- Proposed distinct cookie names: `__Host-xeno_preview_session` (HttpOnly) and
  `__Host-xeno_preview_csrf` (readable double-submit value), both Secure,
  SameSite=Strict, Path=/, no Domain. Standard cookies are not relayed by the preview.
- A dedicated trusted HTTPS loopback hostname separates the preview cookie jar
  from the existing localhost test backend. Select and verify an available binding
  during implementation; port separation alone is not cookie isolation. Never strip
  Secure, relax SameSite, bypass a browser certificate warning or silently install
  a trust anchor. Any required local trust installation needs separate confirmation.
- The local boundary preserves approved cookie attributes, rejects unknown auth
  cookies and token-bearing successful responses, never prints credentials, and
  does not persist upstream secrets to files, env or arguments.
- Login/session creation, rotation, self-logout and ordinary security metadata are
  explicitly permitted writes. “Read-only” means no business-data or financial
  mutation, not that authentication can operate without session/audit records.

## 6. Operation policy and isolation

Default deny every operation not explicitly qualified by normalized method, route
and query schema. Reject ambiguous encodings, duplicate/conflicting scope fields,
method overrides, unexpected redirects, WebSocket upgrades and proxy subroutes.
Do not use `/api/auth/*`, all GETs, or broad API prefixes as allow rules.

The first read inventory covers these existing surfaces, after their callees have
passed no-write tests: auth validation; account overview/notifications/sessions;
dashboard stats; billing overview/subscription/ledger/entitlements; user settings;
workspace membership/list; workspace-scoped project list/detail. Each concrete
route, parameter limit and handler dependency goes into the versioned policy table.
Unknown or not-yet-audited endpoints remain visibly unavailable, never mocked.

Explicitly deny checkout/portal/consent creation, generation, tool execution,
schedule actions, team/project mutations, preference updates, grants, account
deletion, other-session revocation, registration, password recovery, verification
mail resend, OAuth authorization/token exchange and legacy session migration.
This-session refresh/logout are narrowly allowed with CSRF.

Restrictions must survive direct upstream replay of the preview cookie, header
removal, added Authorization headers, refresh, upgrade/exchange attempts and alternate
router mounts. Reject multiple credential classes rather than silently selecting a
more privileged one. Any server-internal derived token retains the preview session
binding, and cannot become an exportable standard session or gateway credential.

Preview data reads use a request-scoped read-only database transaction/connection
where feasible, with no helper escaping to a writable global pool. A failed write
must not be swallowed into a fabricated zero balance or success. Missing ledger or
workspace initialization is reported explicitly; it is not repaired through preview.
Provider/network side effects are separately denied; a DB read-only transaction
does not stop an HTTP request from spending money.

The local mode removes competing external proxies, verifies upstream TLS, strips
untrusted forwarded headers, uses bounded body/time limits and never follows
unapproved redirect destinations. CSP restricts scripts/connections/forms/frames/
images/workers to the reviewed local sources; asset fetches need their own read-only
proxy rules. Ordinary navigation outside this preview is clearly outside its guard;
it does not turn the operator's entire real account/browser into read-only mode.

## 7. Verification and failure behavior

| Gate | Required evidence |
| --- | --- |
| Credential contract | Real local HTTP login emits no bearer/refresh token, no cookie before transaction commit; production cookie attributes verified in a real browser |
| Authentication failure | Invalid/suspended accounts fail; malformed cookies, missing/wrong CSRF and storage failure cannot issue authority; only safe error text |
| Restricted authority | Every denied operation reaches neither its handler nor provider; direct-upstream replay, missing mode header and injected Authorization still denied |
| Read purity | Before/after business-table and ledger fingerprints unchanged, including users with no personal workspace/ledger account; no provider calls; missing data stays unavailable |
| Rotation | Simultaneous refresh, delayed responses and expiry cannot widen purpose or resurrect an older secret; define and test deterministic stale-refresh behavior |
| Logout | This preview session is revoked, other real sessions survive; failed revocation is not reported as confirmed success |
| Compatibility | Existing password, OAuth, CLI and OIDC clients retain their verified contracts; preview cannot migrate/refresh into standard authority |
| Local guard | Mock upstream receives zero blocked requests; competing proxy paths, encodings, redirects, egress, rebinding and cross-origin requests tested; cookie jar isolated from localhost test backend |
| UI | Real-account sign-in, reload and read pages work; persistent mode banner; blocked controls have explanations; local workspace selection does not persist remotely |
| Packaging | Clean source manifest, migration order, full regression/typecheck/build and secret-sink scan tied to immutable image revision |

Existing test donors: `scripts/browser-auth-contract.test.mjs`,
`src/server/tests/browser-bff-session.test.mjs`, `scripts/platform-foundation.test.mjs`,
`scripts/local-preview.test.mjs`, and the isolated `qualify:backend-local` /
`qualify:platform-local` runners. These are prior foundations, not evidence that
the new preview restriction exists. Add explicit preview-policy and proxy tests.

Fail closed on missing migrations, unavailable policy, unknown purpose, expired
session or unverified upstream contract. No fallback to unrestricted hosted access.
Expose safe reason codes and policy/image versions, not passwords, tokens, cookie
values, user content or raw query strings. Non-business security logging is bounded.

## 8. Implementation and rollout sequence

1. Review this specification and authorize implementation separately.
2. Read-only production inventory: exact image/source, migration ledger, existing
   client expectations and canonical release policy. Resolve dependencies against
   that image; use a clean worktree and scoped commits, preserving other WIP.
3. Implement restricted sessions, read projections and proxy offline. Test all
   denial/purity/compatibility cases against synthetic data and a mock upstream.
4. Rehearse additive migrations and rollback on a separately restored snapshot.
   Include normal session survival and preview session invalidation tests.
5. Produce the immutable candidate digest, exact manifest/migration IDs, dry-run
   output, retained backup/restore evidence, health checks and rollback image.
   Follow the canonical release guide and existing default-dry-run deploy tooling;
   never pass a dirty-source bypass or treat build-only as no external change.
6. Ask for action-time approval for the specific backend rollout. Until then, keep
   the local production connection disabled. No signup/indexing/payment changes.
7. After approved deployment, verify endpoint and policy versions and existing-client
   health. Then start the guarded local preview and let the user sign in directly.
8. Use the real account only for reads and self-session lifecycle. Perform destructive
   denial exercises on staging/fixtures, not by attempting purchases against production.

## 9. Rollback

Keep additive columns/table on application rollback; do not drop session tables or
restore an entire live database merely to revert code. A pre-policy backend could
mistake preview sessions for standard authority: **before reverting to one, close
preview admission and invalidate all preview-purpose sessions while the policy-aware
backend is still running**. Confirm invalidation before changing images. Standard
sessions must survive. Rehearse this ordering and the failure path when invalidation
cannot complete; in that case do not activate an image that lacks enforcement.

The local preview also stops forwarding on policy-version mismatch. It is secondary
protection, not a substitute for server-side invalidation. Never use the generic
image rollback blindly while preview sessions can remain valid.

## 10. Acceptance and current review status

The change is complete only when every gate in section 7 has revision-bound evidence,
the actual hosted runtime enforces preview authority, and the user's authenticated
local page displays real data without business-table/provider writes. A 401 instead
of 404 at the bridge endpoint alone is not acceptance.

Current status: specification prepared; no preview enforcement code, deployment
artifact or live connection produced by this task. No production change occurred.
Open prerequisites: verified live baseline, cookie-aware compatibility scope, trusted
isolated loopback origin, and the real account's available sign-in method. Social
callback support remains separately unqualified, not deleted from the requirement.

## References

- Root `XENO AUTH - SPEC.md`: sections 4, 7, 10 and 12; existing origin owns identity.
- [MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie): Secure, HttpOnly, SameSite and host-only cookie constraints. Do not assume changing ports isolates cookies.
- [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252): registered redirect and external-user-agent requirements for native flows; not permission to impersonate another registered client.
- `docs/specs/platform-launch-closure.md`: broader launch work remains outside this scoped preparation.


