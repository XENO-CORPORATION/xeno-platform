# Decision: move the OIDC issuer to `https://xenosystem.ai` in stages

**Status:** PROPOSED 2026-10-28, awaiting the owner's confirmation of the shape below. Nothing is built.
**Owner's decision (relayed by the Spawn session, 2026-10-28):** *"fix thr plstfomr sonitnuses xenosystem ai"*, then
**"Staged move"**, described to the owner as: *"The platform session makes the platform accept tokens under both
names and publish xenosystem.ai as its name, so nothing breaks. Each product is then moved when it's next worked on,
like Spawn already is. Only after the last installed app accepts the new name does the platform stop issuing the old
one."*

## What this changes in the existing decision

Two records already govern the issuer and both are followed here except for one point:

- `XENO DOMAIN MIGRATION - AUDIT.md` §4 (2026-08): *"Dual-issuer is NOT safely possible"*, because OpenID Connect Core
  §3.1.3.7 requires a client to compare `iss` for **exact** equality with the issuer it discovered, and RFC 8414 §3.3
  requires a discovery document's `issuer` to equal the URL it was fetched from. One provider answering with two
  issuer values is non-conforming.
- `xeno-design-guide/XENO REBRAND - MIGRATION PLAN.md` (resumed 2026-10-24): *every RP accepts both issuers →
  `OIDC_ISSUER` flips once → HTML 301 old → new, `/api/*` excluded.*

**The one point superseded: "flips once".** A single flip breaks every installed copy that pins the old issuer, and an
installed app cannot be changed from the server. That is what the owner's staged move avoids. It is done without the
non-conforming shape §4 rules out:

> **Each host is its own consistent provider.** `https://xenostudio.ai` stays an OpenID Provider with issuer
> `https://xenostudio.ai`, and `https://xenosystem.ai` becomes one with issuer `https://xenosystem.ai`. They share the
> signing key, the user table and the sessions. Each discovery document names its own host (RFC 8414 §3.3 holds on
> both), and every token carries the issuer of the provider that issued it (OIDC Core §3.1.3.7 holds for every client).

§4 called this "Escape B" and rejected it as *"doubled identity surface, gained nothing over a coordinated flip"*. The
gain is the owner's requirement: installed apps keep working while products move one at a time. The cost is bounded and
temporary, because the old provider is retired at the exit below.

## The design

1. **Issuer chosen per request, from a closed list.** `issuer(req)` = the canonical origin of the host the OIDC request
   arrived on, if that origin is in `{issuer(), …XENO_ALIAS_SITE_ORIGINS}`; otherwise the old issuer. Never a header
   the client can choose freely (Host is checked against the list; X-Forwarded-* is ignored, as `dpopResource.js` does).
2. **The issuer is bound at the first step and carried through.** An authorization request records the issuer it
   started under; the code it yields, the tokens minted from that code, and the refresh family all carry it. Redeeming
   a code or refreshing a token on the OTHER host is refused (`invalid_grant`). This closes §4's "Escape A" hazard: a
   client that discovered on one host and is redirected through the other still gets one consistent `iss`.
3. **The platform accepts both issuers wherever it verifies its own tokens** (resource middleware already ignores
   `iss`; `verifyAccessToken`, the broker exchange and the back-channel paths that pin `issuer()` accept either).
4. **Server-to-server assertions** (Mail, Comms, Post, Workflow, Compute ports, Connect) are signed with the issuer
   **that consumer is configured to trust**, old by default; each one moves when its consumer accepts the new name.
5. **DPoP** `htu` already accepts the alias origin (#945); unchanged.
6. **Behind one flag**, `XENO_ISSUER_PER_HOST`, fail-closed to today's single old issuer when unset.

## Blast radius (measured 2026-10-28)

- **Live refresh tokens: 4,354 across 25 clients** — agent-cli 2,336, spawn 759, storage 419, workshop 192,
  workshop-local 187, extension 151, shell 107, api-portal 105, canvas 46, places 9, mobile-ios 9, corpus 7, browser 6,
  workflow 5, hub 5, notes 2, agent-interface 2, and pixel, sound, slides, sheets, docs, architect, engine, motion 1
  each. **All keep refreshing on the old host, unchanged.** 55 registered OIDC clients.
- **Code naming the old issuer, by the Spawn session's count:** 24 repos (platform 27 files, mail 8, agent-interface
  8, agent-cli 6, extension 5, anima 5, browser 4, workshop/shell/hub 3, sound/post/mobile/engine/docs/api-proxy 2;
  workflow, use, storage, core, canvas, api-platform 1). Not every hit is an `iss` check.
- **Platform call sites of `issuer()`:** 37 across 19 files (OIDC provider, DPoP, MCP, Tasks, workspace API, agent
  cloud runs, browser relay, compute ports, Connect authority, collaboration, marketplace broker, shell sessions, web
  connect, Comms, Mail, Post, Workflow).
- **Already on the new name:** Spawn (reads the issuer from discovery since rc.90).

## Rollback

Unset `XENO_ISSUER_PER_HOST`: every new token is the old issuer again, and nothing minted under the old name changes.
A product already moved to the new host must point back at the old one (its config), so moved products are kept few
until the first ones have run for a while. Tokens already minted under the new name stay verifiable by the platform
(it accepts both) until they expire.

## Exit (contract)

The old provider stops issuing when **both** hold: (a) no live refresh family under `iss=https://xenostudio.ai` has
been used for 30 days (a query on the refresh table, by issuer), and (b) every product's version floor excludes builds
that pin the old issuer. Then the old host's discovery and token endpoints answer with a pointer to the new provider,
and the alias stays only for links.

## Proof required before each step

- Expand: a test on a real database that discovery on each host names that host; a code started on one host cannot be
  redeemed on the other; a refresh family cannot cross; the platform accepts both; flag off = byte-identical to today.
  Mutation-checked. Then a real sign-in, refresh and revoke for one product on each host in production.
- Each product move: that product's own sign-in, refresh and revoke on the new host.

## What would make us revisit

A client library that cannot be told which provider it belongs to, or a product that must use both hosts in one
session.
