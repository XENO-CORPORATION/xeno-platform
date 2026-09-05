# XENO Platform authentication status

Evidence date: 2026-09-03

Product phase: **Phase 1 — Demonstration** (`PHASE.md`).

## Local implementation status

| Boundary | Current implementation | Evidence level |
| --- | --- | --- |
| Identity origin | `xeno-platform` remains the only browser password and social-login verifier. | Source + local tests |
| Browser credential storage | The browser receives an opaque `HttpOnly`, `SameSite=Strict` session cookie. The stored value is a SHA-256 digest; browser JavaScript never receives the credential. | Source + real PostgreSQL integration test |
| Browser request authority | Same-origin API requests use the cookie. Unsafe methods require a double-submit CSRF value that is also verified against the server-held session row. | Source + real PostgreSQL integration test |
| Session lifecycle | Login creates a seven-day server session, refresh rotates the session and CSRF secrets, logout revokes the session and clears both cookies. | Source + real PostgreSQL integration test |
| Legacy browser bearer | A prior `xenoos_auth_token` value is read into memory once, immediately deleted from storage, and may be exchanged once for the opaque browser session. It is never persisted again. | Structural gate |
| OAuth/OIDC provider | ES256 discovery/JWKS, authorization-code PKCE, refresh rotation/reuse-family revocation, device grant, DPoP, broker exchange, scoped clients, step-up, and global logout are implemented. | Source + provider policy and disposable-PostgreSQL suites |
| Shared account SDK | The canonical implementation is present in `xeno-post/packages/account-kit` as `@xeno-corporation/account`, including browser/BFF, desktop/keystore, CLI, DPoP, broker, verification, and redaction contracts. | Source + package test/typecheck/build qualification |

## Authority inconsistencies that remain visible

The locked root contract names the package `@xeno/account`, while the skill and implemented package
name it `@xeno-corporation/account`. This status record does not silently rewrite the locked contract;
the package identity must be reconciled at the ecosystem authority layer before publication.

The auth skill also names these required root briefs, but neither exists in the current root checkout:

- `orchestrator/briefs/2026-08-27-xeno-auth-ecosystem-execution-spec.md`
- `orchestrator/briefs/2026-08-27-xeno-auth-shipped-surface-inventory.md`

Their absence is an authority-record gap, not evidence that the implementation is absent.

## Qualification boundary

Local source, build, structural, provider, and database-backed tests can qualify this checkout.
They do **not** prove that production has this revision, that `api.xenostudio.ai` enforces its DPoP/
audience contract, or that every already-released XENO product consumes the canonical SDK. Production
deployment, live provider discovery, real Google sign-in, cross-product SSO, logout propagation, and
resource-server rejection tests remain release qualification and require the exact deployed revision.
