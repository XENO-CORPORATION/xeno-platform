# Chat projects Phase 6 local qualification

| Field | Value |
|---|---|
| Captured | 2026-08-29 |
| Host | `DESKTOP-9LJ2CLU` |
| Platform implementation head | `d318843844ca2adc3a75970b150d9a37edf4c30e` on `codex/overview-taskbar-edge-divider` |
| Gateway head | `7786cf50fd13a615370d2c67ab689256237c7376` on `codex/chat-durable-run-authorization` |
| Runtime head | `0f35bcb971a814ea996d7fc831cbc454e90bb838` on `codex/chat-embedding-main-port` |
| Runtime release base | `65ebc127a61baf2f5ff17e3f3450b1014fa60c06` (`origin/main`) |
| Embedding bundle digest | `2dc870de10066111e27bc6c25375d27f455e1de8a277b9bc5623f473ac9d2121` |
| ONNX Runtime DLL | 11,567,648 bytes; SHA-256 `52f8ebe8f08f369a44fed6d1cb680c7c89169795e1c2949ee25b88b538ef0948`; file version `1.20.20241030.2.c4fb724` |

This record covers local and clean-checkout qualification only. Push, deployment,
production enablement, live worker execution, and authenticated browser proof remain
separate release gates and require the explicit external-side-effect approval in the
XENO product release procedure.

## Clean-checkout provenance

- Platform parent candidate `2bab579b73640fa790647307d13e34b37b75f0f0`
  was checked out detached at `.worktrees/qual-platform-chat-2bab579`. The only
  later source change before this record was the live auth-smoke correction in
  `82d75eb`; `c5c2397` updates specification evidence only.
- Gateway behavior candidate `069477ad540262257a0cca9dc9195dd57838343c`
  was checked out detached at `.worktrees/qual-api-proxy-069477a`; final
  `7786cf5` adds the dry-run-first exact-checkout deployment path and a
  loopback-only candidate bind without changing durable-run semantics.
- Runtime parent candidate `c2e015c0baa609499f626931e26e89ee607e1d84`
  was checked out detached at `.worktrees/qual-xrt-c2e015c`. The final runtime
  commit `14197d6` changes only the provisioning script whose default-manifest
  path was then executed successfully into an independent destination.
- Runtime `0f35bcb` adds the private-network Docker deployment, pinned Linux
  ONNX Runtime archive, isolated target-host candidate proof, and image rollback
  after the qualified runtime commit `14197d6`.
- The excluded `origin/main..39f1049` runtime range remains 48 commits, 727
  files, 633,684 insertions, and 3,022 deletions. It is not part of this release.

## Database and migration gates

- PostgreSQL 15 (`postgres:15-alpine`): a fresh database applied 41 of 42
  migrations and explicitly deferred the semantic migration because pgvector
  0.8.6 was unavailable.
- PostgreSQL 15 plus pgvector 0.8.6
  (`pgvector/pgvector:0.8.6-pg15-bookworm`): a separate fresh database applied
  all 42 migrations.
- Core real-database integration: 14 of 14 passed.
- Real semantic integration through the packaged runtime: 5 of 5 passed.
- The independent gateway suite passed 22 of 22 against the fresh database,
  including invented keys, wrong/current principal binding, retained tombstones,
  user deletion, retry boundaries, and actual least-privilege role separation.

## Platform gates

- `npm ci` completed from both root and server lockfiles with zero audit findings.
- `npm run typecheck` completed with zero diagnostics.
- `npm run build` transformed 5,318 modules, passed the production Chat fixture
  boundary across 418 emitted files, and prerendered 271 pages with the locked
  no-sitemap posture.
- The complete root `npm test` chain passed from the detached checkout, including
  the 33-test project/ingestion/readiness contract suite, the real database and
  semantic suites, and every existing reachable repository gate.
- Clean-checkout scale qualification inserted 100,000 rows across two tenants in
  the same physical hash partition and passed tenant isolation, partition pruning,
  lexical fallback, recall@12 `0.9947916666666666`, and p95 `148.6863 ms` over
  16 measured queries.
- The live server auth smoke was corrected to accept only the intentional
  `403` plus `registration_closed` gate (as well as validation/rate-limit
  responses); its 12 assertions then passed.

## Runtime gates

- `cargo test --workspace --locked` passed with zero failures; only tests that
  explicitly require separate real-model/manual fixtures remained ignored.
- `cargo build --release --locked -p xrt-server -p xrt-cli` passed.
- Offline `bundle import` reproduced the exact digest-addressed bundle in the
  detached checkout.
- Default-manifest ONNX companion provisioning completed from the final script
  and reproduced the pinned DLL identity above plus its license and third-party
  notice.
- A release `xrt-server` bound to `0.0.0.0:3199`, reported the exact locked
  Nomic revision/pooling/normalization/512-dimension contract, and loaded
  `onnxruntime.dll` from the release binary directory.
- Missing and wrong bearer credentials returned `401`; the correct credential
  returned `200`.
- Independent tokenizer plus ONNX execution compared all 512 values with the
  HTTP runtime: maximum absolute error `1.4901161193847656e-08` for query and
  `4.470348358154297e-08` for document; cosine parity was 1.0 within float32
  rounding and query/document cosine was `0.8852699398994446`.

## Deployment-path gates and live preflight

- Platform `d318843` adds a dry-run-first pgvector cutover that validates the
  observed live database image, takes and lists a production backup, restores
  it into an isolated retained pgvector volume, runs the exact backend migration
  image, quiesces the API for the production backup/cutover, and restores into a
  separate retained PostgreSQL 15 volume on failure.
- Gateway `7786cf5` refuses a dirty or drifted live checkout, builds a release
  directory, binds its candidate only to loopback, snapshots tracked bytes,
  and health-gates the PM2 swap with automatic rollback.
- Runtime `0f35bcb` pins the Rust builder, Debian runtime, ONNX Runtime Linux
  archive, and Nomic bundle identities; publishes no host port; and tests an
  authenticated candidate on the target Docker network before swapping.
- Local deployment tests passed 4/4 for the database cutover, 4/4 for the
  gateway, and 4/4 for the runtime. All three operator entry points completed
  their default dry runs without external mutation.
- Read-only production inspection found `xeno-platform-001` still using
  `postgres:15-alpine` image ID
  `sha256:cd848ee12e8efaf62a09b7e7290a287c21f332a32779048afb970d497374bb04`,
  with no `chat-workers` or embedding service yet. `xeno-private-api-001` runs
  `xeno-api-proxy` under PM2 from `/home/bunker/apps/xeno-api-proxy`, but that
  checkout contains substantial uncommitted production work and therefore must
  be captured, reviewed, and merged before the exact gateway candidate can be
  deployed. No live state was mutated during this inspection.

## Release sequence still required

1. After explicit approval, capture the current gateway production worktree on
   a preservation branch, review it against remote `main`, merge the Chat
   candidate without dropping live capabilities, and push/merge all three exact
   release branches.
2. Build the exact platform backend image without swapping, then apply/confirm
   the additive schema and qualified pgvector cutover.
3. Deploy the exact runtime plus bundle and prove component readiness.
4. Deploy the reconciled exact gateway and prove run-ledger health before provider/credit dispatch.
5. Deploy platform web and workers with semantic backfill and scheduler claims disabled.
6. Enable semantic backfill, then scheduler claims, after all component probes pass.
7. Prove lexical-only behavior during semantic outage, a real worker recovery path,
   exactly-once committed conversation effects, live HTTP surfaces, and authenticated
   browser hard reloads.
