# Message = XENO Comms — decision record (2026-10-23)

**Owner decision (2026-10-23):** "for message we already have xeno comms right? that will power this … why are you
inventing stuff that we already have as products?" then "right away full scale". The workspace's Social › Message
area is a FRONT-END to XENO Comms. The platform stores no messages. The in-platform message store that was being
built on `feat/workspace-message` is abandoned; only its screen layout was reused.

## Context
XENO Comms (`xeno-comms`) already has the messenger: users with `kind human|agent` (an agent is owned by a person),
conversations of kind `dm | group | channel | thread`, workspaces, messages in ScyllaDB, receipts, a Phoenix
realtime gateway, and a **platform auth mode** in which it checks every bearer by calling a platform URL
(`XENO_COMMS_PLATFORM_AUTH_VALIDATE_URL`). What it did not have: an authority on who belongs to a XENO workspace,
division, team or project. That authority is the platform's.

## Options
1. **Store a Comms credential per person on the platform.** A second credential to rotate and leak. Refused.
2. **Send the person's own platform token to Comms.** Comms would accept a token minted for another audience, and
   the platform does not hold the browser's token server-side. Refused.
3. **A 60-second assertion the platform signs** (chosen, same shape as Publish → XENO Post). ES256 with the key at
   `/api/oauth2/jwks`, `aud: xeno-comms`, `typ: xeno-comms-assertion+jwt`, `sub` = the acting member (a person or an
   agent, each a Comms member in its own right), optional `xeno_scope`. Comms keeps its existing callback model:
   its validation URL becomes `GET /api/comms/identity`, which verifies the assertion, spends its `jti` once, and
   answers the member's `kind`, `ownerId` and the signed scope. A person's own session token from a Comms app is
   answered exactly as `/api/auth/validate` answers it, so one URL serves both.

## Scoping (the part that must not break)
- A channel is ONE scope: `workspace`, `division:<id>`, `team:<id>` or `project:<id>`. Its audience is computed from
  the platform's records on every open (`services/xenoComms.js` `audienceOf`): workspace/division = workspace
  members; project = who can see it; team = active team members plus the workspace's admins. An agent is included
  only while usable and only with its owner in the same audience.
- Every read and write through the workspace checks the caller is in the audience **before** Comms is called.
- Comms is told to make the channel's membership exactly the audience: `POST /v1/platform/scoped-conversations`,
  with the member list bound to the assertion by `members_sha256` (a list that does not match the signature is
  refused). A member who is no longer vouched for is set `removed` in Comms, so they also lose it in their own Comms
  apps and the realtime gateway (both read `conversation_members.state`) — on the next open by anyone.
- Direct messages only between two people who are both members of the current workspace; listed only while they are.
- `@agent` hand-off from a message is the chat's own hand-off (`chatHandoff.delegateWork`): a task delegated to the
  agent, filed in the project for a project channel, with a reply in the thread saying where the work went.

## Blast radius
- Platform: four additive tables (`comms_members`, `comms_channels`, `comms_direct_messages`, `comms_assertion_uses`)
  holding links only — no message text (asserted by the test). DOWN drops exactly these (round-trip executed).
- New routes `/api/message/*` (signed-in) and `/api/comms/identity` (called by Comms). Scopes `message:read|write`,
  three capabilities `message.*` (agents list, read and post in channels they belong to; no DM or hand-off tool).
- xeno-comms PR: identity carries `kind`/`ownerId`/`scope`; agents register as `kind=agent` owned by their person;
  new endpoint `POST /v1/platform/scoped-conversations`; migration 011 (two nullable columns, two partial indexes).

## What it needs to run for real
- Platform box: `XENO_COMMS_API_URL` (Comms API base, no `/v1`) and `XENO_COMMS_GATEWAY_URL` (the Phoenix socket,
  `wss://…/socket`). Unset API = every Message route answers `message_not_configured`.
- Comms: `XENO_COMMS_AUTH_PROVIDER=platform` and `XENO_COMMS_PLATFORM_AUTH_VALIDATE_URL=https://xenosystem.ai/api/comms/identity`
  (API and gateway), migration 011 applied, `XENO_COMMS_ENV=production` with real secrets. Today `xeno-comms-001`
  (VM 106) is stopped and its stack is a development deployment (alpha auth, literal secrets, LocalStack, a non-git
  snapshot): it must be redeployed from `main` with production configuration before this is switched on.

## Rollback
Unset `XENO_COMMS_API_URL` (every route fails closed); run this migration's DOWN. Comms keeps its messages.

## Revisit when
The platform implements `client_credentials` + RFC 8693 token exchange, or Comms gains a native OIDC
resource-server mode — the assertion is then replaced by an exchanged token with the same claims.
