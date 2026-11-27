# How we made it — XENO Platform

One entry per step, newest first: what changed, the owner's words that decided it, where the material is, and the
numbers that proved it. Started 2026-11-21 (global rule of 2026-11-18: the platform is recorded like the Volumes).
Earlier steps are in `CHANGELOG.md` and XENO Index's release record (`/workspace/releases`).

## 2026-11-27 — storage.xenosystem.ai, XENO Storage on its own host

**What changed:** storage.xenosystem.ai stopped redirecting into the workspace. It shows Storage alone, full screen, on
the workspace's own rail, curve and plate. Its places are the host's addresses (`/`, `/recent`, `/starred`, `/shared`,
`/trash`, `/usage`, `/folders/<id>`, `/teams/<id>`). It has its own sign-in client (`xeno-storage-web`) with the silent
check. The product hosts' rails became one table (`HOST_RAILS`), so chat. kept its buttons and the next host adds one
entry. PRs #1223, #1226, #1227.

**Decided by:** the owner, 2026-11-21 (typos corrected): *"we need the same for storage.xenosystem.ai right? to have that
drive-like interface ... that made people be familiar with ... but under our XENO system logic for his account"*, and
2026-11-27: *"finish the rest of the interfaces that need to be on the platform"*.

**How the leaders do it, and what we took:** Google Drive, Dropbox and OneDrive put the place list (My files, Recent,
Starred, Shared, Trash, storage used) on one left column, each place with its own address. We took that list and those
addresses, on our own construction rather than a copy of theirs, and kept Gemini's slim rail when the sidebar is collapsed.

**Proof:**
- `npm run test:storage-host-ui`, against the workspace's own Storage page:
  - layout equal at 1920 and 768 px (rail 56, curve 15, sidebar 63/7, plate 338/7/7/7, radius 14), and at 390 px the drawer is closed;
  - every place's address;
  - a 120 MB file in 8 parts plus a folder through the upload panel.
- Mutation check 7/7. Host sign-in 16/16 for storage.
- After deploy, the served bytes are identical in the container (33/33 scripts), and a browser follows the silent sign-in from outside with no loop.

**Material:** `X:/code/bunker-corporation/_process-archive/2026-11-27/xeno-storage-host/` (captures before and after
#1227, logs, scripts, INDEX with provenance). Tags: `devlog`, `community`.

## 2026-11-21 — Depot credentials for headless agents (`xdp_`)

**What changed:** a person can issue one of their agents an `xdp_` credential for Depot, which Runner needs to read
the repos it builds (Depot decision 0002 §2). The agent acts as itself: its own grants, capped by its owner's and by
the credential's scopes.

**Decided by:** the same owner's go as the entry below; the shape is Depot decision 0001 §3 ("an `xdp_` credential bound to
a platform agent, owner-capped like every agent").

**How the leaders do it, and what we took:** GitHub fine-grained personal access tokens and GitHub App installation
tokens (scoped, expiring, shown once, stored as a hash); the XENO Tasks `xtk_` credential's exact shape (prefix to
find the row, SHA-256 of the whole token to prove it), so the ecosystem has one credential pattern, not two.

**Proof:** the Depot authority suite with a new credential section, and `npm run test:depot-authority-mutation`:
11/11 mutations caught, the four new ones being secret not compared, revocation ignored, an agent issuing, scopes ignored.

## 2026-11-21 — XENO Depot's identity and per-repo permissions

**What changed:** Depot, XENO's own version control for large game projects, got its sign-in audience
(`xeno-depot`), self-registration for agent CLIs, per-repo permissions in the platform's permission store, and a
staff-only door, all behind one service route its gate calls (`/api/depot/authority`).

**Decided by:** the owner, 2026-11-21 (typos corrected): *"bring this up and running and live on XENO Platform so that
we can work with it"*, and *"for the frontend not yet, we will use the XENO Platform interface as guidance for it ...
and we need everything to be CLI callable as well by agents"*. The contract is
`xeno-depot/docs/decisions/0001-depot-foundation.md` §3. Our reading: Depot verifies and never issues, exactly as XENO
Connect does; the staff-only rule is counsel's open question about the name, not a product choice.

**How the leaders do it, and what we took:** GitHub's fine-grained repo permissions (read, triage, write, maintain,
admin), with org owners administering every repo and members holding a base permission; a GitHub App's
user-to-server token carries the user's access, which is how an agent CLI here acts with its person's access. Perforce
supplies the extra `lock` permission, which large binary assets need. RFC 9068 access tokens with one audience per
resource server; RFC 7591 registration; RFC 8628 device grant.

**Proof:** `src/server/tests/depot-authority.test.mjs` on real Postgres 16, with tokens from the real code exchange
and the real client seed; the mutation script (`npm run test:depot-authority-mutation`, `scripts/depot-authority-mutation-check.mjs`) removed
each protection in turn:

| Mutation | Result |
|---|---|
| scope ceiling ignored | caught |
| door admits non-staff | caught |
| unreadable repo confirmed | caught |
| last admin removable | caught |
| mixed scopes register | caught |
| seed drops the audience | caught |
| stale principal at the door | caught |

Neighbouring suites on fresh databases: oidc-v2 34/0, tasks-mcp-oauth 39, connect-authority ok, auth-token-confusion
28/0, api-key-auth 12/0, workspace-agent-surface 47/0; product-access unit 32/0 and its database proof 7/7.

**Found while building it:** the test caught two defects before they shipped: workspace members were meant to review
but the role map gave them `write` only, and the door read a principal cached from token verification, so a suspension
between two calls on one actor did not close it.

Tags: `community` (how an agent gets exactly its person's access), `devlog`.
