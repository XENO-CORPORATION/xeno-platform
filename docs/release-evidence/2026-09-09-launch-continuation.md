# Platform launch continuation — 2026-09-09

Scope: took over codex thread `01a05615-e9db-7d70-a8b0-04e8ccac0a27`, which stopped
mid-implementation on 2026-09-08. No production deployment, provider write, real
charge, outbound email, signup change, account reset or authenticated customer
mutation. Every production statement below is a read-only measurement taken today,
not a quotation from an earlier document.

## 1. The candidate was missing a day's work, and nothing said so

`codex/platform-release-candidate-20260905` was branched on 09-05. The local
continuation work was done on 09-08 in `.worktrees/full-web-context-platform`,
whose base (`9278420`) predates the candidate — so **none of the 09-08 repairs were
in the candidate**, and the candidate was the thing being prepared for release.

That work was also still uncommitted, in a repo that already carries
`LOST-WORK-2026-09-08.md` describing a tree that got swept. It is now committed for
preservation as `e86b719` on `codex/full-web-context-platform` (289 files, not
pushed, not merged) and the substantive part is ported onto the candidate as
`be9ddcd`.

**Ported by reviewing each diff, not by copying files.** The continuation's
`package.json` sits on an older base: copying it would have reverted the tiptap
upgrade and deleted `test:tiptap-compatibility`. The two genuinely new lines —
`public-health.test.mjs` and `account-action-dialogs.test.mjs` — were added by hand.

Also landed: the 09-05 dependency-licence recovery (`c273820`), which was likewise
sitting uncommitted, this time in the candidate's own worktree.

## 2. Eight backend suites were reachable from no runner at all

Measured across all three runners — the npm chain, `qualify-platform-local.mjs
--backend-only`, and every GitHub workflow:

| suite | what it covers | state on 09-09 |
| --- | --- | --- |
| `dpop-token-exchange` | DPoP sender-constraint, actor, scope, replay | ran nowhere; **passes** |
| `oidc-authority-policy` | OIDC authority policy | ran nowhere; **passes** |
| `register-oidc-client` | client registration | ran nowhere; **passes** |
| `hosts` | host/origin resolution | ran nowhere; **passes** |
| `service-ledger` | service-token ledger | ran nowhere; **passes (15)** |
| `ledger-audit-fixes` | ledger audit | ran nowhere; **passes (41)** |
| `fresh-db-boot` | virgin-DB boot + idempotency | ran nowhere; **was broken** |
| `credit-mirror-drift` | `users.credits` vs the v2 ledger | ran nowhere; **was vacuous** |

Two ledger suites and the DPoP exchange are in that list, so "money and auth are
covered" was true of the files and false of every runner.

**`fresh-db-boot` asserted an exact 82-table production snapshot.** The schema now
has 205 tables, so the suite could only fail. Nothing referenced it, so nothing
reported the rot. The snapshot is a MEASUREMENT, and a stale measurement is simply
wrong — it is now a floor (`missing` is still a hard failure) and idempotency is
checked exactly, between the two boots, which cannot rot. Growth is reported, never
failed: a new migration is not a regression.

**`credit-mirror-drift` prints `SKIP: DATABASE_URL not set` and exits 0**, and on an
empty database it audits zero accounts and reports a pass. Wiring it as-is would
have added a gate that cannot fail. It now brings the schema up, and when there are
no real accounts it seeds one consistent and one drifted account inside a rolled-back
transaction and requires the audit to flag exactly the drifted one.

`scripts/gates-are-reachable.test.mjs` now covers `src/server/tests/` as well as
`scripts/`, reading the qualifier's suite list as TEXT rather than importing it —
importing that file starts Docker containers, so running it is the side effect.
Mutation-checked: removing a suite from the list turns it red.

## 3. Read-only preview sessions — implemented and locally qualified

The in-flight work from 09-08 is finished and gated. Off by default behind
`XENO_READONLY_PREVIEW_ENABLED`; no deployment, and none is authorised.

- `scripts/readonly-preview-session.test.mjs` — 18 tests over real HTTP against the
  real middleware, database synthetic. Mutation-checked five ways.
- `src/server/tests/readonly-preview-lifecycle.test.mjs` — real PostgreSQL, in the
  backend qualifier. Read purity, no lazy writes, rotation, revocation, replay-safe
  migration, standard-session compatibility.

**The real-Postgres suite found a defect the HTTP suite structurally could not.**
`user_sessions.expires_at` is `timestamp WITHOUT time zone`; `absolute_expires_at`
is `timestamptz`. Carrying the first through JavaScript into the second wrote local
wall-clock, read it back as a local `Date`, and stored it as an instant — losing the
UTC offset. On this host (UTC+2) **every preview session was already expired at the
moment it was issued**, by exactly the offset. On a UTC box the two would have
agreed and it would have looked correct, which is the worst version of this bug: it
works in production-shaped environments and fails elsewhere, or the reverse. Both
deadlines now come from the database's own clock. The regression guard reproduces it
exactly when reverted: *"the absolute cap is in the future (was -3599s away)."*

Read purity is asserted by fingerprinting every public table before and after a
complete session. Three exclusions are stated rather than assumed: `user_sessions`
and `browser_session_state` are the session itself; `security_events` is audited
separately and every row must be an auth event about this subject; and on `users`
only `last_login` is stripped — `credits`, `plan`, `email` and `is_active` stay
inside the fingerprint, because excluding the row would let a preview session move a
balance unnoticed.

## 4. Production, measured today — read-only

| what | measured | consequence |
| --- | --- | --- |
| backend | up 24h, healthy; all 12 containers healthy | — |
| **deployed revision** | image `xeno-platform-backend`, built 2026-08-31, **no revision label, no revision file** | 🔴 **there is no way to identify what source is running.** REL-1 cannot verify a deployment against a commit, and the preview spec's "UNKNOWN: exact active production image/source revision" is not merely unknown, it is unknowable from the artifact |
| `/api/auth/browser-session` | **404** | the deployed backend predates the BFF session work; the candidate carries it |
| Stripe keys | `sk_test_` / `pk_test_` | 🔴 production is on **test** keys: nobody can be charged today |
| `STRIPE_EXPECTED_ACCOUNT_ID` | **unset** | 🔴 the runtime account-binding guard is **inert in production** — nothing pins which Stripe account or mode the deployed backend may use |
| `STRIPE_EXPECTED_MODE` | **unset** | as above |
| `STRIPE_BILLING_PORTAL_CONFIGURATION` | **unset** | the portal has no pinned configuration |
| `STRIPE_WEBHOOK_SECRET` | set | — |
| `STRIPE_AUTOMATIC_TAX` | `true` | the local preflight's single blocker is a **local env artefact**, not a production gap |
| `SUBJECT_HASH_SECRET` | set | the local advisory is likewise local-only |
| **signup** | `REGISTRATION_OPEN` empty, `REGISTRATION_OPEN_UNTIL=2026-08-28` | 🔴 **CLOSED since 2026-08-29.** Verified live: `POST /api/auth/register` → `403 registration_closed` |

🔴 **The signup finding contradicts the workspace root `CLAUDE.md`**, which states
the box carries `REGISTRATION_OPEN=true` — "the permanent form — so signup does NOT
close on the 29th, which is the intent." The container does not carry it; it carries
the timed form, and it expired twelve days ago. That file is not corrected here: it
had uncommitted changes from another session when this was found, and appending to a
shared document that already holds someone else's work is the documented way this
workspace loses attribution.

Reopening signup is an explicit launch decision (REL-1), so it was left closed.

## 5. Blocked, and why — not deferred, blocked

**HIER-1 (cross-product workspace/project identity and agent permissions).**
`xeno-agent-interface` carries **49 uncommitted files** on
`chore/xenosystem-scope-adopt`, untouched since **2026-08-26** — including the
contract package, the electron host and `packages/ui`. The Parallel Development
Protocol forbids sweeping another session's work, and this change would edit exactly
those interfaces. The blocker is coordination with that session's owner, not effort.

## 6. What only the operator can do

Nothing below is a code task; none of it can be completed from this session.

1. **Stripe live account.** `acct_1TwgCrLBe83UKv9x` has zero products and no event
   destinations. Create the catalog, the webhook endpoint and the portal
   configuration, then set `STRIPE_EXPECTED_ACCOUNT_ID`, `STRIPE_EXPECTED_MODE` and
   `STRIPE_BILLING_PORTAL_CONFIGURATION` on the box. Until the first two are set the
   account-binding guard is not running anywhere.
2. **Move production off test keys** — deliberately, together with (1), because a
   live key with no catalog is worse than a test key with one.
3. **VAT / OSS registration** and confirming the Kleinunternehmer position.
   Everything mechanical is already in place: Impressum, VAT number DE463398455,
   § 19 UStG notice, withdrawal right, refund policy, named processors, erasure,
   retention disclosure — all green in `compliance:preflight`.
4. **Signup**: decide whether to reopen, and set `REGISTRATION_OPEN=true` (the
   permanent form) if so. It is closed now.
5. **Search indexing**: the site is deliberately de-indexed. Reopening is a decision.
6. **Deployment approval** for the candidate.
7. **The six mailboxes** still outstanding from 2026-09-06: `privacy@`, `security@`,
   `dpo@`, `billing@`, `support@`, `team@` (only `legal@` exists).

## 7. Recommended next code task, before any deployment

Stamp the deployed artifact with its source revision. Today the running image
carries no label and no revision file, so "which commit is live" is unanswerable —
and every remaining gate in REL-1 (deployed smoke, rollback, post-deploy
verification) is a claim about a revision nobody can name. It is a one-line
`--label org.opencontainers.image.revision` in the build plus an assertion in
`deploy-platform.mjs`, and it makes every later step verifiable instead of asserted.
