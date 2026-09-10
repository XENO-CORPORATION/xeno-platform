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
4. ~~**Signup**: decide whether to reopen~~ — **DONE 2026-09-10.** `REGISTRATION_OPEN=true`
   in the permanent form, `REGISTRATION_OPEN_UNTIL` cleared rather than left expired.
   Verified in the container, not in `.env`, and live: `POST /api/auth/register` with an
   empty body answers 400 rather than 403 `registration_closed`.
5. **Search indexing**: the site is deliberately de-indexed. Reopening is a decision.
6. **Deployment approval** for the candidate.
7. ~~**The six mailboxes** still outstanding~~ — **WRONG, and corrected 2026-09-10.**
   All six exist and have since 2026-09-06: `privacy@`, `security@`, `dpo@`,
   `billing@`, `support@`, `team@`, alongside `legal@` and eleven more. Measured in
   `xm_mailbox` on `xeno-mail-001`, not inferred.

   🔴 **This entry was carried forward from the 09-08 register and repeated twice
   without being measured** — including into a "what is left" list on 09-10, which is
   the single most expensive recurring error in this workspace and was committed here
   by the session that had spent the day correcting other instances of it.

   ⚠️ **And the first attempt to check it also said MISSING.** The Cloudflare API
   query looked for per-address `to` matchers and found none, because delivery is a
   **catch-all** rule (`XENO Mail catch-all`, matcher `all`) routing every address to
   the `xeno-mail-inbound` Email Worker, which posts the raw MIME to mail-core.
   Catch-alls are stored on a separate endpoint. *Absence by one route is not
   absence* — the same lesson this file records for the pipe DACL and the blank
   compaction row.

   Proven working, not just configured: `support@xenostudio.ai` holds **7 delivered
   messages, newest 2026-09-09**, so the whole chain — Cloudflare MX → catch-all →
   worker → mail-core → mailbox — demonstrably carries real mail. The other five are
   empty because nobody has written to them, which is a different fact from not
   working.

## 7. The deployed artifact now carries its own revision

Done in this pass rather than recommended. The deploy already knew the SHA — it
passes `--sha` to `remote-deploy.sh` and tags the image with it — and then threw it
away, because a tag is registry-side metadata that a running container does not
report.

It now travels inside the artifact: a `--build-arg`, the standard
`org.opencontainers.image.revision` label so `docker inspect` answers without
running anything, and `/app/.xeno-revision` so the process can report its own
identity. `GET /api/health` returns it. Baked in the last layer, asserted, so a new
commit does not invalidate the apk and npm layers above it. An absent revision
reports `unknown` — a local build genuinely does not know, and an invented value
would be worse than none.

This is a prerequisite for the rest of REL-1, not a nicety: deployed smoke,
rollback and post-deploy verification are all claims about a revision, and until
now none of them could name one. **The next deploy is what makes it true of
production**; the currently running image still carries nothing.

## 8. Verification for this pass

- Default regression: **1,553 tests, 1,530 passed, 0 failed, 23 environment skips.**
- Backend qualification (real PostgreSQL, isolated containers): **19/19 suites,
  `passed-local-only`, zero failures** — up from 13 suites before this pass.
- TypeScript and the reachability, import-boundary and deploy gates all clean.
- Every new gate was proven to fail before being trusted: five mutations on the
  preview boundary, two on the lifecycle suite, one on backend-suite reachability,
  one on the image-import boundary, two on the revision stamping.

None of it was deployed **at the time this section was written**. That changed the
next day — see §9, which is the record of what actually reached production.

---

## 9. Continuation, 2026-09-10 — what reached production

The section above closes with "no production state was changed by this session."
That was true of 09-09 and is not true of the estate today. This section is the
record; the sections above are left as written, because a report of what a pass
did is not improved by editing it afterwards to describe a later one.

### Deployed

| what | revision | verified by |
| --- | --- | --- |
| backend | `92c36f8` | `GET /api/health` reports `"revision":"92c36f8"` — the stamping in §7 is now true of production, which it explicitly was not when §7 was written |
| frontend | `32a7f6c` | build + swap + healthcheck through `deploy-platform.mjs`, then the served bundle read back from the CDN |
| signup | — | `REGISTRATION_OPEN=true`, permanent form, confirmed with `docker exec … printenv` |

### The 106 native browser dialogs are gone

`confirm`, `prompt` and `alert` blocked the renderer, could not be themed, and on a
destructive action handed the reader a browser chrome they have been trained to
dismiss without reading. There were **106 across 47 files**; there are now **zero**,
and `scripts/native-dialogs.test.mjs` holds the line at 0/0/0.

It shipped in four commits because the three kinds are three different problems:

- **alert (65)** — a notification, not a decision. `sonner` was already a dependency
  and `Pricing.tsx` already called `toast.error('Could not start checkout')`, but **no
  `<Toaster/>` was mounted anywhere**, so that call rendered nothing. A failed checkout
  told the user precisely nothing. Mounting the surface fixed a silent failure on the
  payment path before it converted a single alert.
- **confirm (29) + prompt (12)** — a decision, so each needs a real dialog. The
  promise-based `confirmAction()` / `promptAction()` hosts preserve the guard shape
  (`if (!await confirmAction(…)) return;`), which is what kept 41 sites to one line
  each. `promptAction` returns `Promise<string | null>` — the same shape `prompt()`
  returns — so `if (url === null) return;` still means *cancelled*, not *empty*.
- **the enclosing functions** — found by TypeScript, not by reading. `await` outside an
  `async` function is a compile error, so the compiler enumerated every site that
  needed changing.

Three things about the gate itself are worth keeping:

1. **It is a ratchet, not a ban, and that is why it finished.** A ban on day one either
   fails immediately or needs an allowlist, and an allowlist is where the next one goes
   to be forgotten. A ceiling that can only fall turns a 106-site cleanup into a
   monotone one that no commit has to complete.
2. **The JSX-text mask earns its place.** The last "remaining" prompt in the codebase
   was the sentence *"How closely to follow the prompt (higher values = more
   faithful)"* rendered inside a `<p>`. Without masking it the ceiling would have had
   to stay at 1 forever — a ceiling with room in it, which is the one thing a ratchet
   must not have. The mask refuses to span braces, so `{prompt(...)}` is still counted.
3. **The control test had to change shape at zero.** It used to assert "a real instance
   still exists", pointed at whichever kind had not finished yet. That check chased
   `alert` to zero, then `confirm`, and would have had to be deleted — a control that
   asserts something exists becomes a test of nothing the moment the cleanup succeeds.
   It now proves the scan reaches the tree at all (a glob matching nothing reads
   exactly like a clean repo) and that the detector still fires on a known call in a
   fixture. Neither half depends on the codebase being dirty.

**A false positive found and fixed rather than accommodated:** the first scanner
counted the word in JSX prose and in a neighbouring helper's docstring. The fix was
masking, not a raised ceiling — the alternative was a permanent ceiling of 1 that
would have quietly admitted the next real one.

### Two defects the conversion exposed

- **`toast.error` on the checkout path rendered nothing.** No `<Toaster/>` existed in
  either of `App.tsx`'s two render branches. The gate now asserts the mount count
  equals the render-branch count, because a notification surface present in one shell
  and missing in the other fails **silently** in the second — the same shape as Hub's
  unsigned badge, which sat in a component that only mounts after sign-in and so told
  exactly the wrong half of its audience.
- **`scripts/tiptap-editor-compatibility.test.mjs` went red as a side effect**, and the
  cause generalises. It builds its own Vite server with `configFile: false` — right,
  because the real config starts a dev proxy — but that also drops the alias table. The
  moment `TipTapEditor` imported `promptAction → ActionDialog → @xenosystem/elements-react`,
  a bare specifier that resolves in the app resolved nowhere else. Its aliases now
  mirror `vite.config.ts` **including the ordering rule**: deeper specifiers first, or
  `@xenosystem/elements` swallows `@xenosystem/elements/tokens` and the stylesheet
  resolves to `.../src/index.ts/xeno-elements.css`.

### Verification

- `npm test`: **1,585 tests, 1,562 passed, 0 failed, 23 environment skips.**
- `tsc --noEmit`: clean.
- `native-dialogs`: 7/7, mutation-checked — adding one `confirm`, one `prompt` and one
  `alert` turns it red; restoring turns it green.
- The **shipped bundle** was read back from the CDN and scanned: the single remaining
  match is the string `` `prompt(agentId, options)` `` inside an embedded markdown
  documentation blob, which is prose, not a call. Zero real dialogs ship.
- Prerendering survived the deploy — `/product/canvas` serves 6,673 bytes with its own
  `<title>`, against the 4,936-byte SPA shell. Checked by **content**, because this SPA
  answers 200 for paths that do not exist and a status code proves nothing here.

---

## 10. Continuation, 2026-09-10 (second pass) — payload and licence evidence

### PERF-1: the entry chunk is 1.44 MB, down from 2.99 MB

The first PERF-1 implementation took the entry from 7.17 MB to 2.99 MB by
deferring the workspace and creative routes. This pass took it to **1,444,418
bytes raw / 366,151 gzip / 294,123 brotli** — 1.55 MB off the payload every
first-time visitor downloads before anything renders.

It began with a measurement rather than a guess, and that mattered: the answer
was not where a guess would have pointed. `scripts/entry-chunk-inventory.mjs`
reads rollup's own module accounting through the REAL `vite.config.ts`, so it
reports the build that actually ships:

| bytes | package |
| --- | --- |
| 599,560 | katex |
| 319,193 | framer-motion |
| 273,415 | parse5 (via rehype-raw) |
| 112,452 | react-syntax-highlighter |
| ~400,000 | unified / micromark / mdast / hast |
| ~500,000 | all sixteen `src/content/docs/*.ts` |

None of it is reachable from the homepage, and every byte of it was on the
homepage. Two independent causes, and the first is the more interesting one:

- **`ProductLanding` asked `getProductDocs(slug)` for one boolean** — does this
  product have documentation? — and that import pulls the docs registry, which
  imports all sixteen content modules. Half a megabyte of prose on the
  most-visited route on the site, to evaluate a `!!`. Nothing failed. The page
  was correct, every test was green, and the only symptom was a number nobody
  was looking at. It now asks `src/content/docs/_slugs.ts`, which imports
  nothing.
- The docs and forum routes were eager, so the whole markdown toolchain shipped
  to every visitor. Eleven routes now go through the existing `lazyRoute`.

**`/` stays eager deliberately.** Deferring the route a first-time visitor
actually lands on trades a smaller download for a blank frame plus a second
round trip, which is worse on exactly the connection this is meant to help.
`/v1` and `/v2` are preserved older homepages and are not that route.

Total emitted JavaScript is unchanged at 13.9 MB. The code moved; it did not
vanish — and the smoke asserts both halves of that, so a build with the code
simply deleted could not pass.

### Three gates, because the win is easy to lose by accident

- **`scripts/check-entry-budget.mjs`**, wired into `npm run build` immediately
  after `vite build`, because that is the only place the OUTCOME exists. A
  source-level rule ("these routes must stay lazy") is a MECHANISM, and this
  repo has already shipped a gate that pinned a mechanism while the mechanism
  itself was the bug. Fails over budget; fails when there is no build at all,
  rather than passing on nothing.
- **`scripts/docs-slug-registry.test.mjs`**. `_slugs.ts` is a hand-written copy
  of a derived fact, which is the shape that rots, so the comparison runs in
  BOTH directions: a product with docs missing from the list is a link that
  never appears; one in the list without docs is a link to a 404.
- **`scripts/smoke-route-render.mjs`** (release-time — it needs a served build).
  Drives the real bundle in a real browser and asserts the Suspense fallback is
  gone, the route's own content is on screen, and katex is ABSENT from `/` while
  ProductDocs, DocsSearch, katex and the highlighter themes arrive on
  `/docs/hub`. Swapping those two expectations turns both red; `/` fetches
  exactly one chunk.

Verified against **production** after deploying, not only locally: every route
renders and the deferred chunks arrive on demand.

One existing gate had to be repaired, and it went red for the right reason with
the wrong assertion. `scripts/forum-moderation-ui.test.mjs` required the literal
eager import line, so it failed a change that left the page exactly as reachable
and faster. It now checks the two things it always claimed to — App reaches the
module, the module is bound to the URL — and is verified red both when the route
is removed and when the module becomes unreachable.

### Licence evidence: six unresolved packages now have six stated reasons

`scripts/recover-package-license.mjs` attempts the recovery mechanically:
verified tarball -> declared repository -> immutable commit -> a shipped file
that hashes **identically** at that commit -> the licence text there.

**The byte match is the whole point.** Text from a repository is evidence for a
published artifact only if the two are shown to be the same code. Without it, a
record asserts "a licence exists in a repository that shares a name with this
package" — which is not a fact about what we ship, and is indistinguishable from
one that is.

Its success path is proven rather than assumed: `--verify` rebuilds an existing
record and requires agreement, and it reproduces **both** hand-made records
exactly — `boolbase@1.0.0` and `tr46@0.0.3`, integrity, commit, licence text and
the overlapping runtime proof. Without that this would be a builder whose happy
path had never once run.

None of the six recovered, and each failed differently:

| package | blocker |
| --- | --- |
| `dingbat-to-unicode@1.0.1` | built `dist`; nothing matches tag `js-1.0.1` |
| `eastasianwidth@0.2.0` | **binding FOUND** (`0f2098de`, 2017-12-28) — the licence file was added 2024-06-05 |
| `guid-typescript@1.0.9` | repo moved to `snico-dev`, no tags, no licence at all |
| `highlightjs-vue@1.0.0` | built `dist`, plus CC0-1.0 declared against a BSD-3-Clause repository |
| `react-remove-scroll-bar@2.3.8` | upstream tags stop at v2.3.7; 2.3.8 is untagged |
| `split-ca@1.0.1` | tag resolves (`4fb87455`); no licence has ever existed upstream — and the repo is `bushong1`, not the `Tarnasa` the packet guessed |

`eastasianwidth` is the one worth reading twice: **the bytes are bound and a
record was still not written**, because pairing 2024 licence text with 2017
bytes is the precise claim this evidence store exists to prevent. It is a human
question, and it is now recorded as one rather than as a silence.

A false negative was fixed on the way: the licence-filename list missed
`MIT-LICENSE.txt`, so `eastasianwidth` read as "no licence anywhere" when the
repository has one. A refusal that says "no licence file" is worth checking by
eye before believing.

**No determination is signed.** The packet still reads
`awaiting-human-source-and-rights-evidence`, because it should.

### Verification for this pass

- `npm test`: **1,595 tests, 1,573 passed, 0 failed, 22 environment skips.**
- `tsc --noEmit` clean.
- Every new gate mutation-checked: two directions on the slug registry, an
  under-budget and a no-build case on the entry budget, a swap of both chunk
  expectations on the route smoke, three softenings on the licence builder, and
  two on the repaired routing gate.
- Deployed: frontend `e80af0c`, verified from the CDN and by driving production
  in a browser.

---

## 11. Continuation, 2026-09-10 (third pass) — the compliance surface, done in-house

Framing first, because it changed the work: most of what had been written down as
"needs a lawyer" was not a legal question. It was an engineering question wearing
legal clothes, and answering the engineering half dissolved most of it.

### Six unresolved licences to zero

| package | what it actually was |
| --- | --- |
| `guid-typescript@1.0.9` | pulled by `onnxruntime-web`, a **root production dependency imported by nothing** — 91 MB, the only "onnxruntime" strings in `src/` are seeded forum-thread text about a different package. Removed; the question went with it. |
| `dingbat-to-unicode@1.0.1` | pulled by `mammoth`, declared in the root manifest **and** in `src/server`, referenced only from the latter. Root declaration removed; now server-only. |
| `highlightjs-vue@1.0.0` | **never a conflict.** CC0-1.0 declared, BSD-3-Clause repository — but 1.0.0 shipped 2019-11-18 and that LICENSE was added 2019-12-24. |
| `tr46@0.0.3` | **one rule doing two jobs** (see below). |
| `eastasianwidth@0.2.0`, `react-remove-scroll-bar@2.3.8`, `split-ca@1.0.1` | irreducible: the publisher named a licence and never wrote the text. |

Removing the two dead dependencies took **16 packages** out of the client graph.
The entry chunk hash was byte-identical before and after, which is the proof they
contributed nothing to what ships.

**What actually reaches a browser was measured**, from rollup's module accounting
rather than a grep over minified output — a grep answers a different question,
because minification renames identifiers and a string can survive from someone
else's comment. Of the original six, exactly one — `react-remove-scroll-bar`,
4,479 bytes — is in the built bundle. The rest are build tooling, server-side, or
leaves that tree-shaking never includes.

### tr46: rejecting a record hid the finding it was protecting

`recoveredLicense()` discarded the whole record because a single runtime proof
carried a `status`. So a grant proven byte-for-byte — `index.js` matches the
pinned commit exactly — was thrown away, tr46 reported as "no licence text
found", and the genuinely interesting fact vanished into a silence that read like
an ordinary gap.

Two questions, answered with each other's evidence:

1. Is the licence text bound to this artifact? **Yes.**
2. Does the artifact contain material under other terms? **Open** —
   `lib/mappingTable.json` is generated by the repository's own
   `scripts/generateMappingTable.js`, which downloads
   `unicode.org/Public/idna/latest/IdnaMappingTable.txt` and reduces it to
   code-point ranges. It is therefore derived from Unicode Consortium data under
   terms neither the package nor its repository mentions.

Separated, both are now stated. The notice carries the component and its
explanation; an **unexplained** non-match still rejects the record, and that is
mutation-checked.

### Declaration-only attribution, and why it is not a forgery

Five publishers named a licence and published no text. No search finds a document
that was never authored, so the choice was between recording that honestly and
shipping a notices file with a hole — and a hole reads as an oversight rather
than as a finding.

The danger is specific: **a canonical SPDX text with the author's name
substituted in reads exactly like a notice the publisher wrote**, and nothing
downstream could tell afterwards. So the entire design is about keeping the two
distinguishable:

- the canonical text is reproduced **verbatim**, `<year> <copyright holders>`
  intact, and is never interpolated;
- the declared holder sits **beside** it with its own stated source;
- the text is labelled `spdx-canonical`, pinned to a commit of
  `spdx/license-list-data`;
- the absence is recorded as evidence — full archive inventory, repository,
  filenames tried — so a later reader can re-run the search rather than trust it;
- and the notices **markdown** carries the caveat, because the markdown is what
  gets read.

It is the last route, after the archive, the recovered commit and the
source-header routes have produced nothing, and it refuses when any of them was
available.

**Result: 951 packages, 949 with texts, 2 first-party, 0 unresolved.** The
third-party notices file is complete for the first time.

### A conflict that was a chronology

The check compared a manifest against its repository **as it stands today** and
called any difference a dispute for a human. That reading manufactured one:
`highlightjs-vue@1.0.0` was published five weeks before the BSD LICENSE landed.
Nothing disagreed at the moment being asked about. The comparison now asks WHEN,
and records a later relicensing as the dated fact it is — while a licence file
that predates a release and still disagrees remains a real conflict and still
refuses.

### The 14 pending assets were already resolved

Re-checked by hash against the two records written since: all 39 files are
covered — 23 by the owner's 2026-09-05 confirmation, 16 by `assets.json` as
AI-generated with a generator, a rights basis and evidence on disk. Nothing was
outstanding. The file had simply not been re-read since those records were
written.

The patterns are **kept**, because the backward-looking half is the less useful
one. `public/landing-v3/` is exactly where a stock photograph would land and look
ordinary beside sixteen legitimate files, so a new file there with a hash in
neither record now fails the build. It compares hashes, never paths — a path
comparison passes when a file is replaced in place, which is how an asset gets
swapped unnoticed.

### What is genuinely left, and it is small

- **`STRIPE_AUTOMATIC_TAX`** — the preflight's one remaining blocker is a LOCAL
  env artefact. Production carries it; verified in the container.
- **Trademark**, and whether the owner confirmation or the provider
  output-rights basis suffices for a particular use. Unchanged, unsigned, and
  deliberately not asserted anywhere in this pass.
- **The Kleinunternehmer crossover** — not an open question. `docs/TAX-POSTURE.md`
  is LOCKED and carries the five coordinated steps, including the warning that
  the preflight will keep reporting the § 19 notice green after it stops being
  true, because it checks the notice is *present*, never whether § 19 still
  applies.

### Verification

- `npm test`: **1,609 tests, 1,587 passed, 0 failed, 22 environment skips.**
- Mutation-checked: interpolating a holder into a canonical text, removing a
  component's explanation, relaxing the unexplained-non-match guard, a new
  unrecorded asset, an asset swapped in place, and a rights basis rewritten to
  announce a clearance nobody signed — every one turns a gate red.
- One existing assertion was changed, deliberately and with its reasoning in the
  test: `recovered-package-licenses.test.mjs` required `undefined` for tr46,
  which achieved the opposite of its own name. It now asserts the outcome and is
  strictly stronger.
