# Publish = XENO Post — decision record (2026-10-20)

**Owner decision:** "we are missing lots of the divisions and products we documented… full scale … with everything
backend logic full done" (2026-10-20). Publish is the first area made real under it.

## Context
The workspace's Social › Publish area listed sample posts. XENO Post is live at `post.xenosystem.ai` and already signs
people in through the platform OIDC (client `xeno-post`), storing the person's XENO account id as
`users.xenoAccountId`. Its REST (`/api/v1`) accepts its own session JWTs and workspace-scoped `xpost_` API keys.

## Options
1. **Store an `xpost_` API key per workspace** on the platform (encrypted). Works today, but it is a second
   credential and a second link beside the existing account link, and an entrusted secret to rotate and leak.
2. **The platform calls xeno-post with the person's own OIDC access token** (`aud: xeno-api`). Refused: every platform
   API would then accept tokens minted for another product, and the platform does not hold the person's token anyway.
3. **A short-lived assertion the platform signs** (chosen). ES256 with the key at `/api/oauth2/jwks`, `aud: xeno-post`,
   `typ: xeno-post-assertion+jwt`, 60 s, `sub` = the person, `act.sub` = the agent when one acts for its owner,
   `xeno_workspace` + `post_workspace`. xeno-post verifies it against the JWKS it already trusts and resolves the person
   through the link it already has. This is the RFC 7523 JWT-bearer shape Google and Microsoft use for
   service-to-service calls on a user's behalf.

## Blast radius
- Platform: `publish_workspace_links` (which xeno-post workspace a XENO workspace publishes through — no secret) and
  `publish_confirmations` (agent-proposed times awaiting a person). Additive; DOWN drops both.
- New scopes `publish:read`, `publish:write`; five capabilities `publish.*` (drafts, proposed times, reads).
- xeno-post: **must add an assertion guard** (below). Until it does, every call answers `post_refused_assertion`.

## What xeno-post must change (owned there)
- A guard beside `ApiKeyGuard`: accept `Authorization: Bearer <jwt>` whose header `typ` is `xeno-post-assertion+jwt`,
  verify ES256 against `XENO_PLATFORM_URL/api/oauth2/jwks`, require `aud = xeno-post`, `iss = the platform issuer`,
  `exp - iat ≤ 60`, a single-use `jti` (Redis, 120 s); resolve `sub` → `users.xenoAccountId`; set `actorType: 'agent'`
  when `act` is present; require `post_workspace` to equal the route's `:wid` and the user to be a member.
- Set `XENO_POST_API_URL=https://post.xenosystem.ai/api/v1` on the platform box once that ships.

## Rollback
Unset `XENO_POST_API_URL` (every route fails closed with `publish_not_configured`); run the migration's DOWN.

## Revisit when
xeno-post gains a native OIDC resource-server mode, or the platform implements `client_credentials` with token
exchange (RFC 8693) — the assertion is then replaced by an exchanged token with the same claims.
