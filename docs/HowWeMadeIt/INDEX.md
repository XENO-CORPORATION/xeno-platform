# How we made it — XENO Platform

One entry per step, newest first: what changed, the owner's words that decided it, where the material is, and the
numbers that proved it. Started 2026-11-21 (global rule of 2026-11-18: the platform is recorded like the Volumes).
Earlier steps are in `CHANGELOG.md` and XENO Index's release record (`/workspace/releases`).

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
