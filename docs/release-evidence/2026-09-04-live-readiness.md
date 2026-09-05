# Live payment readiness — 2026-09-04

Verdict: **not yet production-qualified; no live cutover performed**.
Checkout: `.worktrees/full-web-context-platform`, branch
`codex/full-web-context-platform`, HEAD
`9278420998c6d0d51d43fa3aa5ebfb5472679e9f` plus uncommitted changes.
This is a continuation receipt, not an immutable release artifact.

## Read-only target measurements

- Intended live XENOSYSTEM: `acct_1TwgCrLBe83UKv9x`. Authenticated account API
  reports charges/payouts enabled, details submitted and card payments active.
  Requirements are not exposed; this is not proof of completed KYC review.
- Complete live listings (`has_more=false`): zero products, prices, webhook
  endpoints, portal configurations and tax registrations. Zero tax registrations
  are deliberate in the existing locked tax posture, not independently a defect.
  No tax/business fields were changed or legally re-qualified here.
- Deployed `xenostudio-backend` on `xeno-platform-001` still uses
  `acct_1TZps0V05dWPT2ni` in **test mode**. Expected account/mode pins are absent.
  Stripe secret, publishable key, webhook secret, Resend and SUBJECT_HASH_SECRET
  are present; automatic tax is enabled. Secret values were not printed.
- Public GET `/api/health`, `/api/ready`, `/api/billing/config`: HTTP 200.
  Billing config says enabled, but this is the deployed test setup. HTTP health
  does not prove a checkout, webhook, receipt or production entitlement journey.

### Legacy mappings: database absence is not provider absence

Read-only database counts: two `billing_customers`; zero `billing_events`,
`billing_charges`, personal Stripe subscription mappings, workspace Stripe
subscription mappings and consumed checkout sessions. `billing_account_binding`
does not exist on the deployed database.

Read-only provider inspection of those two mapped customers, with complete
listings and without disclosing customer identity:

1. Test customer exists; one expired checkout; no subscriptions or PaymentIntents.
2. Test customer exists; one **active test subscription**, two succeeded test
   PaymentIntents and one completed checkout.

The second customer proves why empty local subscription/event tables cannot
authorize deleting mappings or changing provider accounts. No customer,
subscription, transaction or mapping was changed. Reconcile old-account state
and preserve its evidence before binding a live account.

## Local repairs

- [Runtime binding contract](../specs/billing-runtime-account-binding.md): explicit
  pins/key modes, fresh bounded account checks, live-sale capability gating,
  canonical provider event lookup before ledger processing, transaction-local
  database lock/query timeouts, database singleton
  binding and refusal to silently adopt any of six legacy billing-state classes.
  Refund/cancellation reconciliation does not depend on permission to make new sales.
- Deployment now requires a main-contained commit and fails closed on Git errors.
  Application archive and remote controller both come from the same pinned SHA;
  working-copy controller bytes cannot leak into a committed release.
  `--allow-dirty` cannot bypass ancestry. Normal local dry-run refuses the WIP.
- Launch runbook stale source-presence observations were corrected; key-only live
  cutover instructions now require account/data reconciliation. Requirements were
  retained, not removed to manufacture readiness.

## Verification

- Final default `npm test`: exit 0, **1,382 tests / 1,360 passed / 22 skipped /
  0 failed / 0 cancelled**, summed across 84 test summaries.
  Log: `C:/Users/bnkr/AppData/Local/Temp/xeno-live-readiness-final-20260904.log`.
- Six-file focused billing/account/preflight/receiver/qualification suite:
  **91 passed**, exit 0.
  Log: `C:/Users/bnkr/AppData/Local/Temp/xeno-live-readiness-focused-20260904.log`.
  The final database-timeout addition separately passed 31 focused tests, then
  the complete default suite above was rerun successfully.
- `npm run test:release-guard`: **111 passed**, including 16 deploy tests.
  Disposable real-Git tests exercise absent main, equal/ancestor and unmerged/
  divergent commits. No production upload or remote execution took place.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0; 495 emitted files pass the production Chat-fixture
  boundary and 298 product pages prerendered. Existing ambiguous Tailwind utility
  warnings remain; this is build evidence, not full UI/performance qualification.
  Log: `C:/Users/bnkr/AppData/Local/Temp/xeno-live-readiness-build-20260904.log`.
- Isolated `node scripts/qualify-platform-local.mjs --billing-only`: **60
  PostgreSQL/signed-HTTP checks passed**; backup/restore preserved 26 tables,
  94 rows and eight verified ledger chains; owned-resource cleanup passed.
  Includes real PostgreSQL lock/query timeouts, rollback and pooled-setting
  restoration. Receipt:
  `C:/Users/bnkr/AppData/Local/Temp/xeno-launch-evidence-ZcglF3/report.json`.
- Local compliance preflight finds consent, Terms, Privacy and retention source
  mechanisms. Its failure for unset local automatic-tax configuration is **not a
  production finding**: deployed automatic tax is enabled. Source presence does
  not provide legal approval. No new legal or tax conclusion is made.

Historical hosted sandbox lifecycle/receipt evidence remains in
[the hosted report](2026-09-04-stripe-hosted-lifecycle.md), but predates this new
runtime guard. Repeat provider qualification using the sandbox's actual
publishable key and Event-read access before promoting the guard.

## Required cutover sequence — not execution approval

1. Complete canonical auth qualification against the reviewed authority briefs.
   They are absent from the current root checkout but were recovered read-only
   from root `origin/main` (`5d4efe5eb25b211aabeace1b97fb818b3f0750db`):
   `orchestrator/briefs/2026-08-27-xeno-auth-ecosystem-execution-spec.md` and
   `orchestrator/briefs/2026-08-27-xeno-auth-shipped-surface-inventory.md`.
   Initial absence was a checkout mismatch, not an operator-only blocker. No
   auth/session redesign was attempted in this billing continuation. Refresh the
   dated surface inventory before claiming ecosystem-wide conformance.
2. Reconcile existing WIP into a reviewed, tested main-contained immutable
   candidate. Production-shaped restore/migration and rollback evidence remains
   required; the fixture restore above is not a substitute.
3. Requalify hosted sandbox payment, canonical-event reads, settlement, refunds,
   receipts and relogin on that candidate. Preserve old-account reconciliation
   evidence, including the active test subscription found above.
4. Prepare the exact live resources from the canonical service catalog (no legacy
   flat Team price offered), HTTPS webhook event set, portal, account/mode/key
   bindings and reviewed data transition. Preserve host-local secrets, account
   access and signup restrictions. Do not add tax registrations automatically.
5. Present the artifact/configuration diff, affected accounts, monitored alerts,
   rollback and remaining business approvals for a fresh cutover go/no-go.
   Any real-card charge/refund must have an explicit amount/payer approval.
6. Deploy the approved candidate and verify live settlement-to-ledger-to-access,
   receipt delivery and recovery. Only then decide signup/indexing reopening.

After a live payment, preserve and reconcile newly accepted money and events
even if the application must roll back. Never restore away financial history.
Other open platform gates remain in [the closure register](../specs/platform-launch-closure.md).

## 2026-09-04 final local hardening continuation

This continuation supersedes the older local test counts above. It does not
supersede the live-provider, immutable-candidate, compliance, deployment or
commercial approval boundaries.

### Closed locally

- Browser session creation now fails closed: failure to persist the revocable
  session row returns 500 and never mints the former sid-less seven-day bearer
  fallback. A real PostgreSQL trigger fault proves both bearer-login and
  browser-login routes return no token and no cookie on persistence failure.
- Both static CLI authorization pages now use the opaque HttpOnly BFF session,
  same-origin credentials and double-submit CSRF. They remove legacy URL token
  parameters without consuming them and never store or send a browser bearer.
- Live billing setup has a deterministic, offline-by-default, account-pinned
  plan for ten nonlegacy EUR inclusive prices, the derived 11-event webhook and
  a customer portal. Its catalog digest is
  `65295a0eca3a32a2ba44d40ec4e0818abb03e4fbf925be69f488502c32eba736`.
  The two mutating stages still require explicit `--confirm-live`; neither was
  run.
- The runtime and preflight now require a specific active live Billing Portal
  configuration and verify the return URL, payment update, invoice history,
  cancellation-at-period-end/no-proration and disabled plan switching policy.
- A read-only billing reconciliation tool inventories all mapped customer
  pages and active obligations under repeatable-read database isolation. Its
  output remains `cutoverApproved: false`; it cannot authorize adoption.
- Shared Rust builds delegate to the canonical `xeno-lib` and `xeno-edit`
  manifests. Both release builds completed successfully; stale platform-root
  workspace manifests were removed.

### Current local evidence

- Full isolated platform qualification: 49 migrations fresh plus replay,
  25/25 workspace/project database checks, 1/1 synthetic 100k semantic-scale
  qualification, 60 signed-HTTP billing checks, payment restore of 26 tables /
  94 rows / eight ledger chains, platform restore of 204 tables / 200,271 rows,
  and owned-resource cleanup. Receipt:
  `C:/Users/bnkr/AppData/Local/Temp/xeno-launch-evidence-ShpQiX/report.json`.
- Fresh backend/auth qualification passed every named suite and the browser BFF
  lifecycle, including the persistence fault injection. Receipt:
  `C:/Users/bnkr/AppData/Local/Temp/xeno-launch-evidence-Ho0Tx6/report.json`;
  fault log:
  `C:/Users/bnkr/AppData/Local/Temp/xeno-launch-evidence-Ho0Tx6/browser-bff-session.log`.
- `npm run test:payment-ops`: 90/90 passed. Final default `npm test`: every
  reachable suite passed, zero failures/cancellations/TODO; 22 integration
  cases were explicitly skipped by the ordinary no-database/no-embedding
  environment and are covered by the isolated qualification above.
- `npm run typecheck`: exit 0. `npm run build`: exit 0, 5,340 modules
  transformed, 495 emitted files passed the production Chat-fixture boundary,
  and 298 product pages were prerendered while de-indexing remained active.
  Existing ambiguous Tailwind utility and stale Browserslist-data warnings are
  nonzero release-quality work; the build did not fail.
- `npm run build:libs`: both canonical Rust release builds passed.
- `git diff --check`: no whitespace errors; only Windows LF-to-CRLF notices.

### Compliance and outward boundaries still open

The completed exact-directory audit at `.compliance/audits/20260904T192815Z`
remains **BLOCK**: 17 findings (one BLOCK, 15 REVIEW, one FIX). The previous
unknown component declarations, generic BSD findings and unreadable-file
blockers are resolved in this snapshot. The first-party backend
`xenostudio-server` is identified through the checker's existing `--self-name`
interface, not granted a fabricated third-party license. ScanCode and Syft
completed; ORT failed as a non-gating corroborating layer. The `dist` directory
was inspected, but this dirty tree is not a final immutable release candidate.

The user explicitly authorized SCANOSS source-fingerprint disclosure during
this continuation. The initial and delta scans report zero matches and zero
uncovered files for **1,499 indexed scannable files**, most recently at
`.compliance/snippet-runs/20260904T192739Z`. This is coverage of that inventory,
not an assertion that all pending untracked work is a qualified release. There
are additional untracked implementation/test files from the ongoing launch
work. Their candidate ownership and inclusion still need reconciliation.

Dependency evidence was rebuilt from locked npm archives: SRI verification,
exact package identity/version, and original manifest/license text hashes.
`compliance/npm-license-evidence.json` now contains 208 records across frontend
and backend lockfiles. Comparing both lockfiles with HEAD after removing only
license fields proves no dependency versions, URLs or integrity values changed.
Eight focused tests cover corruption, hash downgrade, source-text tampering,
archive traversal/symlinks, duplicate manifests, cache identity, immutable
upstream provenance, embedded notices and npm repository spellings.

`node scripts/collect-third-party-notices.mjs` collects a conservative superset
of all non-dev lockfile packages, including optional platforms. It verified
1,072 package records: legal texts collected for 1,053, one explicit first-party
scope entry, and **18 unresolved package texts**. The original texts and source
links/hashes are in `.compliance/notices/sources.json`; the Markdown alongside
it is a **review candidate, not a completed distribution notice**. When npm
omits a license file, only an integrity-bound published gitHead or an embedded
grant is used; a moving default branch is never substituted. Copyleft and
non-npm obligations remain separate review work.

The prior `compliance/assets.json` declarations were withdrawn: a Git
introduction commit does not prove an asset's origin or rights. The replacement
`compliance/asset-provenance-pending.json` records history and the missing
evidence without claiming clearance. The older audit that accepted the former
declarations must not be used to clear the asset gate. Runtime uploads were
removed from the Git index and ignored; all 33 local files remain on disk.
The 27 `.git.backup/` recovery files were also removed from the index and
ignored, with every local file preserved. License evidence now retains the
actual declaration sources rather than unrelated README bodies (476,955 bytes),
so it remains readable by the source inventory scanner.

Open review groups are: 151 provenance/restriction markers; five first-party
product/documentation files quoting GPL/AGPL; Sharp/libvips LGPL combinations;
highlightjs-vue (CC0), robust-predicates and tweetnacl (Unlicense); and the dirty
candidate. These require evidenced determinations, not assumed clearance.
The asset blocker covers 39 files. The notices finding requires attribution for
917 components under the audit's scope; the collector's 1,072-record scope is a
deliberately broader lockfile superset, not a contradictory count.

The full regression initially failed because this worktree had no backend
node_modules. Restoring 476 packages with locked `npm ci --ignore-scripts
--no-audit --no-fund` fixed the local environment. The rerun exited 0: 1,429
passed, 22 environment-dependent skips, zero failures/cancellations/TODO.
Log: `C:/Users/bnkr/AppData/Local/Temp/xeno-launch-license-regression.log`.
The eight current focused evidence tests also pass. Install scripts were not
run; this does not independently prove optional native runtime availability.

### Audit isolation and local-preview recovery

The final audit exposed a tooling defect: ORT containers continued after the
Docker CLI timed out and had the developer checkout mounted read-write. Two
containers were verified by their exact audit-output mounts and stopped. Their
package-manager activity had removed backend dependencies. The canonical
checker now analyzes a separate indexed working-file snapshot and cleans up
its uniquely named container in `finally`; 447 policy assertions pass,
including success/timeout/exception isolation tests. The prior audit's ORT
failure remains recorded; it has not been relabeled a successful ORT run.

After restoring the same 476 locked backend packages, the existing local
preview launcher succeeded without resetting accounts. Direct API readiness,
frontend-proxied readiness and `http://localhost:5183/login` returned HTTP 200.
No ORT containers remained running. This is HTTP/runtime proof, not a fresh
browser interaction or paid-provider qualification. Local outbound jobs and
paid-service credentials remain disabled.

No live Stripe resources, credentials, customers, subscriptions, payments,
refunds or mappings were changed. No production deployment, signup reopening
or indexing change occurred. The next irreversible step remains a reviewed
exact-resource dry run followed by explicit authorization for the named live
Stripe writes; any real-customer charge remains a separate approval.

### Original landing artwork and truthful demo boundary

At the user's direction, eight landing-v3 assets were replaced using built-in
imagegen: the hero background, CTA space background, and six use-case images.
`compliance/generated-assets-2026-09-04.json` retains each exact generation
prompt, original output path, SHA-256 hash, tool, date and usage description.
No reference images were supplied. These are monochrome concept illustrations,
not product screenshots or claims that XENO generated the displayed output.
Existing XENO logos were preserved. The use-case grid was visually inspected
in the hydrated localhost browser; neutral loading backgrounds replace the
previous colored fallbacks. Illustrations and simulated hero previews are labeled.

This replaces eight of the previously flagged 39 assets; it is not a new audit
PASS or legal signoff. The other 31 assets and final registry adjudication remain
open. Canvas/earth-map replacements and genuine product recordings are not yet
complete. Do not reuse the old unproven demo assets as release evidence.

Demo inspection found that VideoGenerationInterface2 returned random stock clips
from both a global preview bypass and an unsupported-model fallback. Both fake
success paths were removed; unsupported models now fail explicitly without adding
a result. The existing provider-backed path remains. Legacy client-token guards,
model-label/registry mismatches and a real paid generation proof still need work;
no provider call was submitted and video generation is not qualified by this fix.

Restoring declared frontend dependencies exposed three TypeScript errors: one
ES2022 Array.at call under the ES2020 target and two typed-array/ImageData buffer
compatibility errors. These were repaired without changing the compiler target
or suppressing checks. Typecheck passed. Asset/evidence checks are included in
the existing compliance test command. Production and Stripe were not changed.
