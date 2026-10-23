# Office › Mail = a front-end to XENO Mail — decision record (2026-10-23)

**Owner decision:** "for mail we already have xeno-mail right? … that should power this" then "right away full scale"
(2026-10-23). Office › Mail was sample data; it now reads and writes the person's XENO Mail mailbox. The platform is a
**front-end**: mail lives in `xeno-mail` (`apps/mail-core`). The platform stores no message, no body and no mail
credential.

## Context
XENO Mail keys its `user.id` on the person's XENO account id (it signs people in through the platform OIDC, client
`xeno-mail`) and exposes every mail operation as a capability surface — `POST /api/capabilities/<name>` with
`{ args }`, the §8 envelope, audit, read-back — used by its own agents and UI. Publish ↔ XENO Post
(`docs/PUBLISH-XENO-POST.md`) already solved "platform calls another XENO product as the person".

## Options
1. **Store a mail/app password per person** on the platform. Refused: an entrusted secret per person to rotate and
   leak, and IMAP/SMTP would bypass mail-core's labels, drafts, audit and its own refusals.
2. **Forward the person's OIDC access token.** Refused, as for Publish: every platform API would accept a token minted
   for another product.
3. **A short-lived assertion the platform signs** (chosen — the Publish contract). ES256 with the key at
   `/api/oauth2/jwks`, `aud: xeno-mail`, `typ: xeno-mail-assertion+jwt`, 60 s, single-use `jti`, `sub` = the person,
   `act.sub` = the agent, `xeno_workspace`, and `mail_address` (below). mail-core verifies it
   (`apps/mail-core/src/platform-assertion.ts`, xeno-mail PR #3).

## Workspace ↔ mailbox
`mail_workspace_mailboxes (workspace_id, user_id, address)` records which of the **person's own** addresses a workspace
reads (no secret). The assertion carries it as `mail_address`, and mail-core binds that connection of the person **or
refuses — it never falls back to the default** (xeno-mail PR #4, mutation-checked there). Mapping is verified by asking
mail-core as the person before it is stored, and it is a person's act (an agent cannot re-point its owner's mail).
Absent mapping = the person's default mailbox. A per-workspace *shared* inbox (support@) is not this: it needs
delegation in mail-core and is a follow-up.

## Rules
- The mailbox belongs to the PERSON: an agent reads its owner's mail and nobody else's. The workspace scopes the
  mapping and the tasks/tickets/contacts a thread becomes (XENO-WORKFORCE-01 §8.11: members read, editors add).
- **Sending is irreversible:** a person, with `confirm: true` — the screen asks a second time ("cannot be recalled").
  An agent's send is saved as a DRAFT and its id recorded in `mail_agent_drafts`, so the person sees "Drafted by …" and
  sends it themselves. mail-core refuses an irreversible capability for any assertion carrying `act`, so a platform
  bug cannot become agent-sent mail. MCP has no send, discard or mailbox tool.
- Mail is third-party text: every read is `provenance: untrusted`.
- Labels are addressed by **id** (mail-core files threads by label id; a name changes nothing there).

## Blast radius (step-2 inventory)
- Platform DB: `mail_workspace_mailboxes`, `mail_agent_drafts` (ids only), `tasks.source` widened to allow `'mail'`.
  Additive; DOWN drops both tables and restores the CHECK `NOT VALID` so mail-sourced tasks survive a rollback.
- `/api/mail/*` (21 routes), scopes `mail:read` / `mail:write` (new names — scopes are one-way), 13 `mail.*`
  capabilities (`services/mailMcp.js`, category `mail` on `/api/mcp`).
- Contacts go to XENO Customers (`crm_contacts`) — the workspace has ONE contact store.
- xeno-mail: PR #3 (assertion) and PR #4 (`mail_address`) merged into `feat/experimental-release-gaps`, the branch that
  carries the capability surface; xeno-mail `main` does not have either yet.

## Hosting (measured 2026-10-23)
- mail-core runs on **`xeno-mail-001` (VMID 132), which is STOPPED** (`qm status 132` → stopped; disk on `local-lvm`).
  `mail-api.xenostudio.ai` answers Cloudflare **1033** (tunnel down) and `mail.xenostudio.ai` **530**.
- To serve this area: start VM 132 (or move mail-core), deploy mail-core from a commit that contains PR #3 + #4
  (`npm run publish:core` in xeno-mail), confirm `curl https://mail-api.xenostudio.ai/health`, then set
  `XENO_MAIL_API_URL=https://mail-api.xenostudio.ai` on the platform box (listed in compose `environment:`) and verify
  with `docker exec xenostudio-backend printenv | grep XENO_MAIL`. mail-core's `XENO_OIDC_ISSUER` must equal the
  platform issuer (`https://xenostudio.ai`, read live from discovery).
- Until then every route answers `mail_not_configured` and the screen says so. Not deployed by this change.

## Proof
- `npm run test:workspace-mail` — real Postgres against a fake mail-core that verifies each assertion with the
  platform's public key and binds mailboxes the way mail-core does (55 checks).
- `node scripts/workspace-mail-mutation-check.mjs <db url>` — 9 protections removed one at a time; every one caught.
- `npm run test:mail-ui` — browser: header tabs, Compose dialog, Send asks twice, thread/draft addresses, agent drafts.

## Rollback
Unset `XENO_MAIL_API_URL` (fails closed); run the migration's DOWN.

## Revisit when
mail-core gains delegated/shared mailboxes (workspace inbox), or the platform implements token exchange (RFC 8693) —
the assertion is then replaced by an exchanged token with the same claims.
