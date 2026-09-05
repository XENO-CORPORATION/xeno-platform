# Platform launch qualification continuation

Status: local qualification acceptance checks passed on 2026-09-04; NOT public-launch approval.

## Contract and scope

Bring the existing platform toward paid launch without mistaking skipped tests or fixture results for live qualification. This slice makes database, workspace/project isolation, payment transaction and restore checks repeatable against newly created local databases. Continue the full launch register in `../release-evidence/2026-09-04-platform-launch-hardening.md`; no requirement there is retired by this slice.

Tier 2: persisted test data and payment verification are in scope; production changes, live charges, email delivery, provider creation, deployment, signup reopening and shared auth protocol changes are NOT authorized by this local runner. Missing canonical auth supporting documents are recorded, not replaced with a new protocol.

## Evidence ledger

- KNOWN: `package.json` default test chain reaches database suites which use `skip: !process.env.TEST_DATABASE_URL`; see `scripts/chat-workspace-scope.database.test.mjs`, `scripts/workspace-teams.test.mjs`, `scripts/chat-project-database-integration.test.mjs`.
- KNOWN: `scripts/chat-project-semantic-scale-qualification.test.mjs` checks 100,000 same-partition rows, recall, latency, index selection and tenant isolation without an embedding provider.
- KNOWN: `scripts/chat-project-semantic-integration.test.mjs` requires a real embedding endpoint. This is a separate unqualified provider boundary, never replaced by synthetic embedding success.
- KNOWN: `src/server/services/migrationRunner.js` exposes `runAllMigrations` and `migrationStatus`; prerequisites can defer migrations. The runner must reject any deferred/pending migration.
- KNOWN: `src/server/tests/billing-money-in.test.mjs` owns a minimal fixture schema and requires a new `xeno_payment_*` loopback database. It must run separately from the migrated platform database.
- KNOWN: local Docker container `xwc-gate-pg` is running with port 15432 on this workstation (2026-09-04 inspection). No existing database is a test target.
- UNKNOWN: clean schema bootstrap and all database suites pass together. Resolve with the qualification command.
- UNKNOWN: hosted Stripe and real email end-to-end readiness. Resolve only with configured test provider and approved external test execution; previous credential discovery found none.

## Interfaces and invariants

New `npm run qualify:platform-local` creates a UUID-named, run-owned container using the already-installed pinned pgvector image declared by `scripts/remote-chat-database-cutover.sh` (`--pull=never`); the existing container lacks pgvector. It generates a temporary password in memory, never printing it, publishes only a random loopback port, validates local Docker context and container identity, and provisions fresh databases. It never reads an existing account database or copies its rows.

1. Only successfully created, run-owned databases are eligible for cleanup. No `DROP IF EXISTS`, fixed reusable database, global cleanup or production target. Test: ownership/identifier safety unit tests and failed preflight.
2. Empty-database migrations follow all four production schema steps: legacy `runMigrations`, `runAllMigrations`, `migrateAccountV2`, `migrateOidcClients`. Reject deferred/pending versions and replay to prove idempotence. Test: actual fresh database run.
3. Selected database suites must run with positive test counts, zero failures, zero skips, zero cancelled and zero TODO tests. Test: strict Node TAP summary parser, including absent output/failure/skip/TODO counterexamples.
4. Payment fixtures run in a separate newly created database and must emit their explicit positive passed/zero-failed summary with successful exit. Test: fixture-summary parser negatives and real money-in suite.
5. Backup/restore checks compare counts AND deterministic content fingerprints for every ordinary public table of the quiescent payment fixture database, plus ledger chain verification for every fixture account, and migration schema/count fingerprints on the platform database. Restore targets are fresh owned databases, never in-place. Test: actual `pg_dump -Fc` / `pg_restore --exit-on-error` round trip and comparison rejection tests.
6. Reports identify source revision, dirty-worktree state, container image, timings, checks and external gates NOT exercised. Success means local qualification only. A failed prerequisite, test, cleanup or restore produces nonzero exit. Test: parser and actual command outcomes.
7. Test child environment is allowlisted for OS operation plus explicit local fixture configuration; provider credentials/endpoints are not inherited. No network/provider-dependent semantic suite is included. Test: environment allowlist unit test.

## Failure behavior and observability

Docker/DB missing, incompatible pgvector, migration failure, failed/skipped test, restore mismatch: record failed stage, stop subsequent dependent stages, clean only owned fixtures, exit nonzero. Cleanup failure remains visible and fails the command; do not report clean success. Subprocess deadlines bound hangs. Logs identify stages, never connection strings or inspected environment values. No user-facing application behavior is changed by this runner.

## Decisions

Reuse the installed pinned pgvector image and canonical migrations; create an isolated container and databases rather than clone account data. This proves fresh bootstrap, not production-data migration compatibility. Production-shaped migration/backup gates already live in `scripts/deploy-chat-database.mjs` and remain required before deployment.

Lenses: concurrency, money, data, release evidence, credential hygiene. No UI or auth-protocol redesign in this slice. Provider model quality, production performance and commercial policy remain separately qualified.

## Plan / acceptance

1. Independently falsify this contract before implementation; adjudicate findings below.
2. Implement guarded runner and unit tests; wire tests into default chain.
3. Run from this dirty worktree without publishing: clean migrations, project/team scope suites, 100k scale suite, isolated payment suite, restore checks. Repair owned defects surfaced by these tests.
4. Run relevant unit tests and default regression; retain a dated evidence report with exact successes and remaining gates.

Rollback: source edits are reversible. Test state is in the freshly created run-owned container, its anonymous volume, and one parent-owned host scratch directory. Child cwd, TEMP, TMP and TMPDIR all point inside that scratch boundary, so repository uploads and temporary extractor files are also contained and can be removed after a child timeout. Delete only these exact resources after validating ownership; retain redacted evidence logs outside scratch. No existing DB rows or user files are altered.

### Expanded backend execution (2026-09-04)

`npm run qualify:backend-local` uses the same isolated container, ownership checks,
environment allowlist and cleanup, with a new database for each of 13 existing
backend suites. This mode does not run or claim the platform scale/restore stages;
the report names its mode explicitly. Suite failures are collected so later
independent suites still execute; any failure keeps the overall result nonzero.
Named positive summaries plus exit zero are required, with negative parser tests.
The BFF lifecycle suite requires its explicit assertion-completion marker.
Registration is enabled only inside these disposable test children, never the
preview or production server. This is execution evidence, not a canonical auth
conformance audit or hosted-provider qualification.

## Falsification and reconciliation

Independent review: three MATERIAL findings accepted. TODO tests now fail qualification; the complete four-step startup migration order is required; child file artifacts are contained by the parent rather than relying on child finally hooks. Additional measured correction: `xwc-gate-pg` has no vector extension available, while the canonical pinned pgvector image is installed, so use a fresh run-owned container instead. No product requirement or verification assertion is weakened.

The first actual platform restore exposed PostgreSQL's equivalent serialization of literal varchar-array-to-text-array casts. The checker now normalizes only that exact form. Regression tests preserve changed-value/operator/type rejection; row fingerprints and sequence state still compare exactly. Restore receives the bounded scale-test deadline because it rebuilds the HNSW index. A failure closing the admin pool no longer prevents subsequent container/scratch cleanup.

Final independent code review found two further MATERIAL false-pass hazards, both accepted: legacy SQL inputs could be silently absent, and row/constraint/index checks alone did not prove restored ledger write protection. Required legacy SQL files must exist and be nonempty. Schema fingerprints now also include trigger definitions/enabled state, functions, RLS policies/flags, relation/partition properties, views and enums. A transactional negative control disables the restored ledger trigger, requires comparison failure, rolls back and rechecks the healthy state before ledger-chain verification.

## Acceptance evidence

The final full fixture run ended `passed-local-only`, exit 0, at 2026-09-04T06:48:14Z. It passed 49 versioned migrations plus legacy/account/OIDC startup and replay; 25 workspace/project DB tests without skips; the 100k synthetic-vector test (recall@12 1.0; p95 88.26ms across 16 measured queries); 51 payment checks; payment restore with eight verified account chains; and platform restore across 204 tables / 200,539 fixture rows. Cleanup passed; the owned container and scratch directory are absent. Local evidence: `C:/Users/bnkr/AppData/Local/Temp/xeno-launch-evidence-fjFc8F/report.json` with sibling logs. The final default regression is 1,173 passed, 22 skipped, zero failures; 10 new safety/comparison tests are included. TypeScript passes. See the launch record for unchanged external/cross-product gates.
