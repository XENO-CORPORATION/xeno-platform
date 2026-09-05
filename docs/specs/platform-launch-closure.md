# Platform launch closure register

Status: active; local evidence is NOT public-launch approval. Updated 2026-09-04.

## Intent and authority

Deliver a usable paid XENO platform, preserving the existing account, workspace, ledger and shared-theme contracts. This is a Tier 2 continuation of `platform-launch-qualification.md`. Do not retire requirements to obtain a green status. Safe local implementation/testing is authorized; production deployment, real charges, outbound customer emails and reopening signup/indexing require an explicit action-time decision. Preserve other tasks' WIP.

## Remaining work and acceptance

Latest live-readiness continuation (2026-09-04): runtime Stripe account/mode and
database binding guards are locally implemented, and deployments now require
main-contained pinned source. Default regression: 1,360 passed / 22 skipped /
zero failures; 60 isolated DB/payment checks and restore passed. Typecheck and
production build also passed. Production still
uses the old test account. Provider inspection found an active test subscription
despite zero local Stripe subscription mappings. No live resources, deployment,
data adoption or signup reopening occurred. See the
[live readiness receipt](../release-evidence/2026-09-04-live-readiness.md) for exact
inventory, local test scope and cutover gates. Earlier snapshots below remain
historical evidence, not current runtime qualification.

XENOSYSTEM selected for billing on 2026-09-04: live account
`acct_1TwgCrLBe83UKv9x`. Browser inventory shows zero products and no event
destinations. The earlier server test-price evidence belongs to a different
account, not this target. Read-only preflight now requires explicit account/mode
pins and rejects inconsistent keys/account/live capabilities; 69 focused tests
pass locally. [Cutover scope and evidence](stripe-account-cutover.md).
No live setup, key change, customer migration or deployed runtime guard is claimed.

Provider continuation: all ten configured **server test-mode** prices match the
catalog and the enabled endpoint covers 11 deployed handler events, verified
read-only. Stripe/email/Google credentials exist on the server. Payment harness
target isolation, consent binding and cleanup are repaired and tested locally.
Actual transactions require an isolated provider destination; existing test
events target the deployed platform. [Evidence and remaining boundaries](../release-evidence/2026-09-04-provider-qualification-preflight.md).
Final default regression for this continuation: 1,269 passed, 22 skipped, zero
failed; 57 focused price/webhook/harness tests passed. This does not close the
hosted transaction or live-mode collection gates.

Responsive/keyboard continuation: repaired unnamed mobile account/dashboard
controls, chat escaping beneath the navigation rail, hidden mobile session
actions and command-palette keyboard focus/activation. Sixteen navigation tests
and three workspace-layout contract tests pass; live mobile/tablet checks and
remaining provider boundaries are recorded in the
[responsive qualification report](../release-evidence/2026-09-04-responsive-keyboard-continuation.md).
This is not closure of the complete UI-1 or hosted payment/auth gates.

Latest continuation: PAY-2's read-only validator now rejects wrong recurrence
multipliers, metered/tiered/custom/quantity-transformed prices and unknown active
state; lookup failures no longer expose provider exception content. Local gates
passed 91 checks. [Scope and evidence](billing-price-shape-qualification.md).
The target configuration and hosted payment evidence below remain required.

Runtime continuation: both new-checkout producers now enforce fresh price
agreement before customer/session creation. Behavioral tests also exposed and
repaired an undefined offer-eligibility function that crashed subscriptions.
122 adjacent checks and the full default suite passed; Node 20.20.2 passed all
39 checkout/preflight checks. [Runtime guard evidence](billing-checkout-price-guard.md).
Changes are local source, not a deployed or provider-qualified payment journey.

Full test continuation: final regression 1,241 passed / 22 skipped / zero failed;
the isolated platform run separately passed the DB/100k scale tests, signed-HTTP
payment checks and both restores. Thirteen backend suites passed (226 counted
assertions plus BFF lifecycle). TypeScript and production build passed. A test-only
Windows shutdown hazard was repaired; hosted/provider/production gates below are
unchanged. [Dated results](../release-evidence/2026-09-04-platform-launch-hardening.md).

| ID | Work still required | Owning boundary / completion evidence |
| --- | --- | --- |
| PAY-1 | Hosted test checkout, signed provider webhook delivery, delayed payment, subscription changes/cancellation, refunds, receipts and entitlement refresh after relogin | Platform + Stripe test configuration; browser-to-provider-to-ledger evidence, not fixture assertions |
| PAY-2 | Validate target prices, currency, webhook mode/events, tax settings and secret configuration | Target billing/compliance preflight passes; no secret values in reports |
| AUTH-1 | Verify new signup, activation email/code, resend/expiry, Google sign-in, onboarding, welcome grant and session expiry/recovery through the served backend | Canonical auth contract + actual browser/email-provider evidence; auth status register remains authoritative |
| HIER-1 | Cross-product canonical project/workspace IDs, runtime agent bindings, host/folder permission intersection, scheduled task/library bindings and scoped fleet navigation | Platform and owning product runtimes; detailed open requirements in `../workspace-hierarchy-implementation-status.md`, including denial/concurrency/symlink tests |
| UI-1 | Finish shared Elements adoption; replace native account/project dialogs; audit light/dark states, mobile overflow, keyboard/focus and error/empty/loading states | Shared declaration/renderer authority + rendered route matrix, not new local design tokens |
| PERF-1 | Reduce eager application/tool loading and measure route payloads and interaction performance | Built import graph, successful route loading and retry behavior, browser measurements; no claim that bundle bytes alone prove usability |
| DATA-1 | Close startup fail-open behavior, validate production-shaped migration order, backup/restore and rollback procedure | Startup regression + isolated real PostgreSQL boot/replay; production-shaped backup gate separately required |
| OPS-1 | Qualify target health checks, error/latency monitoring, payment/webhook failure alerts, scheduled jobs and recovery ownership | Actual target configuration and safe failure exercises; currently unverified, not assumed absent |
| COM-1 | Confirm commercial identity, terms/tax/refund policy, support contact and operational ownership | Operator/business confirmation; this register is not legal advice |
| REL-1 | Reconcile dirty worktree, create reviewed release artifact, deploy approved migrations/backend/frontend, run deployed smoke and decide signup/indexing reopening | Exact artifact/revision + deployed evidence + explicit launch approval; local source success is insufficient |

## Current bounded implementation: DATA-1 startup schema integrity

KNOWN: production `migrationService.js` silently skips missing legacy schema files and treats duplicate-object SQL errors as successful migration. Qualification currently checks file presence separately, so its preflight is stronger than production startup. Both schema files use SQL-level idempotency guards.

INFERRED: a duplicate error is not proof that the rest of a multi-statement SQL file executed. Suppressing it can boot an incomplete schema. Resolve by propagating all SQL failures and proving replay on real PostgreSQL.

UNKNOWN: hosted provider journeys, target operations and production data migration compatibility. They remain gates above.

### Contract

1. One exported immutable legacy schema filename manifest is shared by startup and qualification. Paths remain rooted at the checked-out server database directory; no environment-provided SQL path.
2. Startup reads and validates every required file before its first database query. Missing, unreadable or whitespace-only files reject startup with the affected filename. Tests inject filesystem read failures and assert zero queries, including failure of the second input.
3. Execute validated schemas in manifest order. Every SQL error, including all previously swallowed duplicate codes, rejects immediately; later files are not executed and success is not reported. Preserve the original error as the cause or rejection.
4. SQL-level guards, not swallowed exceptions, supply idempotency. Real isolated PostgreSQL fresh boot and replay must both pass with the existing four-step startup sequence.
5. Default regression reaches these negative tests. Qualification continues to reject failed/deferred migrations and remains local-only.
6. A shared required-startup pipeline executes legacy, versioned, account-v2 and OIDC-client migrations in that order. Nonempty `skipped`, an empty versioned manifest, or pending final status rejects startup. Production and the isolated qualifier use the same pipeline.
7. The entrypoint awaits required startup before starting cleanup, background workers or the HTTP/WebSocket listener. Pending/rejected tests at each phase prove later phases never run; an entrypoint syntax-tree gate proves these side-effect starters are after the awaited fail-closed block. Readiness cannot open on a failed phase. No global migration atomicity is claimed.

### Sequencing, failures and rollback

Fresh independent falsification of this contract precedes implementation. Then add tests/repair, run focused and default regression, run isolated migration/payment/restore qualification, and reconcile evidence. No new migration or user-data mutation is intended. A SQL failure may follow earlier successful legacy files; startup stays failed and existing idempotent schema guards allow retry after repairing the cause. No claim of global migration atomicity. Revert only this change's source hunks if needed, never reset the dirty tree.

PERF-1 follows only after examining existing error boundaries and the import graph. Preserve routes, auth providers and shared theme behavior; do not introduce a second styling system. All uncompleted rows stay open even when this bounded repair passes.

### PERF-1 first implementation

KNOWN: the previous built entry module is `index-C6L4D37u.js`, 7,174,902 uncompressed bytes. App eagerly imports Overview, standalone chat and OS surfaces; Overview eagerly imports creative routes. Defer those modules without changing route paths, providers, authentication or business logic. A shared route wrapper uses the existing Elements Card, ProgressBar and Button renderers (no new style values or renderer copies). Per-route boundaries retain surrounding providers/chrome and offer explicit retry and reload; never reload automatically or fake loading progress.

Acceptance: DOM tests prove module loading starts on mount only, pending status, successful prop forwarding, rejection, retry invoking a fresh lazy instance and preserved surrounding state. Build and route-contract/type checks must pass. Record emitted entry-size change; this is payload evidence, not runtime latency or full mobile/a11y qualification. Current scoped Elements inventory: one new route fallback, zero local controls/style literals; Card/ProgressBar/Button reused, no new primitive gap. Existing platform ResourceState remains a separately tracked local implementation, not claimed adopted here.

## Evidence and reconciliation

Prior qualification: 49 versioned migrations plus legacy/account/OIDC startup/replay, 25 workspace/project DB tests, 51 payment fixture checks, synthetic 100k-vector scale and fixture backup/restore passed locally. Full previous regression: 1,173 passed / 22 skipped. These are historical local evidence, not hosted or production acceptance.

Continuation results (2026-09-04):

- DATA-1 startup integrity implementation is locally verified: 37 failure/order/import-lifecycle tests pass. Independent final falsification found no remaining material omission in this bounded repair. Hosted restart and production-shaped data compatibility remain open.
- Default regression exits 0: 1,234 tests, 1,212 passed, 22 skipped, zero failed/cancelled/TODO. Log: `C:/Users/bnkr/AppData/Local/Temp/xeno-launch-closure-final-regression.log`. Skips are not live evidence.
- Isolated qualification completed at 07:31:26Z, `passed-local-only`: canonical startup/replay with 49 migrations, 25 workspace/project DB tests, 51 payment tests, payment restore (25 tables / 93 rows / eight ledger chains) and platform restore (204 tables / 200,303 rows). Report: `C:/Users/bnkr/AppData/Local/Temp/xeno-launch-evidence-3zkQQY/report.json`. Successful-run container and scratch cleanup independently confirmed.
- Synthetic 100k-vector qualification: recall@12 0.99479 and p95 137.15ms across 16 queries, with tenant/index/pruning checks passing. This is not real embedding-provider quality evidence.
- PERF-1 first slice implemented: App workspace/chat/OS surfaces, 34 creative/tool route imports and the desktop ImageStudio import load on demand. Two real-DOM/source-contract tests pass, including loader rejection, focus, retry and surrounding-state preservation. Shared Elements renderers provide the fallback; no new palette or local controls were introduced. Full platform conformance remains open.
- TypeScript and production build pass. The actual entry referenced by `dist/index.html` is now `index-CVJKMZTW.js`, 2,951,875 bytes versus 7,174,902 bytes previously (58.86% smaller uncompressed entry module). Other route chunks still download when used; this is not total-session transfer or runtime-latency evidence.
- Browser navigation to localhost billing reached the existing login page. No authenticated billing/chat smoke is claimed in this continuation. The existing non-watching local backend was not restarted; startup fixes are source/isolated-process qualified, not already-running backend proof.
- An earlier interrupted run at `C:/Users/bnkr/AppData/Local/Temp/xeno-launch-evidence-rtW31b/report.json` remains incomplete and is excluded from passing evidence. Its owned container `xeno-qual-64212a2803c369e2b258af1bffaf2c8e` was stopped; its volume and scratch directory were retained after cleanup was denied. No existing shared database was stopped or removed.

All table rows remain open except the explicitly bounded local startup-integrity subtask. This register is the remaining-work list, not a public-release approval. No production deployment, real purchase, external email or signup/indexing change was performed.

Independent falsification accepted two MATERIAL omissions: production also ignored deferred versioned migrations and launched listeners/workers while migrations were pending. Requirements 6–7 close these paths together with the original missing-file/duplicate-error repair.

### Local runtime follow-up

Local preview was restarted using a verified PostgreSQL 17 / pgvector copy of the existing test database: 140 tables / 296 rows preserved, missing vector migration applied, 49-migration replay passed, direct/proxied readiness and fresh login-page rendering passed. Conversion consumption now also starts explicitly after the schema gate. The repeatable launcher verifies owned database/Redis resources, loopback listener and per-launch API identities; preview background work is disabled so copied schedules/notifications cannot execute. See the [recovery evidence](../release-evidence/2026-09-04-platform-launch-hardening.md#local-preview-restart-and-data-preserving-recovery). This closes the local restart defect, not AUTH-1, hosted payments or production release qualification.

### Final local hardening update

The remaining local security/payment mechanisms are now implemented and green:
session persistence fails closed, CLI authorization uses opaque BFF cookies and
CSRF instead of browser bearers, the live Stripe catalog/webhook/portal setup is
offline-by-default and exact-account pinned, Billing Portal policy is verified
at runtime and preflight, prior test billing state has a read-only reconciliation
path, and the canonical shared Rust libraries build in release mode. The full
reachable test chain, TypeScript, production build, 90 payment-operation tests,
and both isolated platform/backend qualification receipts pass. Exact evidence
is in [the live readiness receipt](../release-evidence/2026-09-04-live-readiness.md#2026-09-04-final-local-hardening-continuation).

This does **not** close the launch register. Product compliance is still BLOCK
pending an exact release-candidate audit, license and
asset-provenance reconciliation, completed notices, rights declarations and a clean
candidate. PAY-1/PAY-2 still require the reviewed live resource creation and a
hosted transaction lifecycle; AUTH-1 still requires served Google/email/session
qualification; OPS-1/COM-1/REL-1 remain external/deployed/business gates. No
provider writes, production deploy, public signup or indexing change occurred.

### Compliance continuation

The user has now explicitly authorized the SCANOSS fingerprint disclosure.
The cached scan covers 1,499 indexed scannable files with no matches; this does
not include all pending untracked source files or approve a final candidate.
Both npm lockfiles have integrity-verified license evidence (208 restored
records), with dependency versions/URLs/integrities unchanged. The full local
regression passed again after restoring missing backend dependencies: 1,429
passed, 22 environment-dependent skips, zero failures. Eight focused evidence
tests pass. The conservative notice collector covers 1,072 package records,
with texts collected for 1,053 and 18 still unresolved, plus one first-party
scope entry; it intentionally emits only a review candidate.

Asset declarations based only on Git authorship were withdrawn. Source/rights
evidence remains required and is tracked as pending, not cleared. Refer to the
live-readiness receipt for exact scanner paths and remaining boundaries.
The final audit (`20260904T192815Z`) reports one BLOCK, 15 REVIEW findings and
one FIX. Unreadable-file blockers are cleared, but the 39-asset provenance
blocker, license/provenance reviews and final shipped notices remain open.
An audit-container timeout defect was also repaired in the canonical checker:
ORT now operates on an isolated snapshot and cleans up its own container.
447 scanner policy assertions pass. The local preview was restored using the
existing account database; direct/proxied readiness and the login page return
HTTP 200. This does not change production launch status.

### User-directed original asset replacements

Eight landing illustrations now have fresh imagegen outputs with exact prompts
and hashes in `compliance/generated-assets-2026-09-04.json`; existing XENO logos
are unchanged. The localhost use-case grid has been visually checked. Generation
provenance is not final legal clearance: the remaining 31 old asset findings,
registry review, genuine product recordings and fresh final audit remain open.
The video interface's stock-clip fake-success paths were removed during demo
inspection. Real generation still requires token-guard/model-registry cleanup
and qualification; no paid generation or production mutation was performed.

### User-requested verification checkpoint

The [local generation checkpoint](../release-evidence/2026-09-04-local-generation-checkpoint.md)
supersedes the token-guard/model-substitution TODO above: canonical session handling
and exact model dispatch are locally tested. Gateway support, picker/settings parity
and paid-provider qualification remain open. Five video tests, 13 evidence tests,
the default regression, TypeScript and production build passed. Nested notices are
now collected, but 18 texts remain missing. No new compliance verdict or deployment
is claimed. Work was paused at the user's request at that checkpoint.

### 2026-09-05 resumed notice verification

The collector now retains complete README grants alongside named notices; 17
previously omitted README evidence texts are preserved. Thirteen focused evidence
tests pass; 18 package texts remain unresolved. The refreshed release audit
`20260905T055411Z` is BLOCK: one BLOCK, 16 REVIEW and one FIX. ScanCode/Syft and
tracked snippet coverage completed with zero snippet matches; ORT timed out as
non-gating corroboration and its owned container was cleaned up. Contributor-owner
declarations remain a review, not inferred rights. The asset registry still has 39
unregistered findings, including the eight replacements whose generation evidence
exists but whose registry review is not complete. Untracked WIP needs final-candidate
coverage. No gate was weakened and no publication is authorized by these results.

The existing local preview was restarted without the recover/reset path; direct and
proxied readiness plus login return 200, including after audit cleanup. Paid services
and outbound jobs remain disabled. See the [continuation evidence](../release-evidence/2026-09-05-notice-continuation.md).

### 2026-09-05 generated asset registration

Eight exact generated replacements now have hash-bound origin records and a
documented provider output-rights basis in `compliance/assets.json`. No broad
path exemptions or signed determinations were introduced. Fourteen evidence tests,
the production build and eight independent built-image hash comparisons passed.
Final audit `20260905T063256Z` remains BLOCK (one BLOCK, 16 REVIEW, one FIX), but
the unregistered-asset finding is reduced from 39 to 31. The pending inventory
separates nine identity/icon files from 22 media files; eight older PNGs also have
unvalidated content-credential blocks, which are leads rather than rights proof.
ScanCode, Syft and tracked snippet coverage completed; ORT timed out and its owned
container cleanup passed. No untracked-WIP or public-release clearance is claimed.
Full [registration evidence and remaining actions](../release-evidence/2026-09-05-generated-asset-registration.md).
