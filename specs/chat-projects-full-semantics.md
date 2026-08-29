# XENO Chat Projects: Full-Semantics Completion Specification

| Field | Value |
|---|---|
| Status | Audited implementation contract — implementation in progress |
| Owner | `xeno-platform` |
| Affected repositories | `xeno-platform`, `xeno-api-proxy`, `xeno-rt` |
| Primary surface | `xenostudio.ai/overview/chat` |
| Last researched | 2026-08-29 |
| Repository evidence baseline | `xeno-platform` commit `576dee4ed91642f41b089839c145fd6994fbd86d`, `xeno-api-proxy` commit `16e37360456600c37412c389b2ad1faa13b62c9d`, and the original `xeno-rt` evidence commit `39f10490aa5a739590c007f1b4672881c0c7cfa2` on remote branch `origin/feat/qwen38-mtp`. Release topology is now locked to a narrow embedding port based on `xeno-rt` `origin/main` commit `65ebc127a61baf2f5ff17e3f3450b1014fa60c06`; the 48-commit feature range is explicitly excluded from this release. Section 5 describes the researched baselines, not partially implemented working-tree state. |
| Scope | Project knowledge, account Library integration, collaboration, scheduling, server-authoritative Chat subsystems, migration, release, and live qualification |

## 1. Executive summary

XENO Chat already persists project records, project instructions, Library-backed files, conversations, and scheduled-task definitions. The current implementation does not yet make those records behave as one real project runtime: project instructions and file contents are not assembled into model context, scheduled turns bypass project context, project ownership is personal rather than workspace-aware, scheduled execution has no durable run ledger, and several authenticated Chat subsystems still simulate success in browser memory when the server fails.

This specification closes those gaps as one platform capability rather than as independent UI patches. The resulting system has five invariants:

1. **Library is the canonical asset plane.** Uploads and generated files are account or workspace assets once, with extraction, chunking, indexing, preview, provenance, and access control owned by Library.
2. **Projects are authorization and context boundaries.** They link conversations, schedules, instructions, and Library assets without duplicating asset bytes or extracted text.
3. **Interactive and scheduled generation use the same context assembler.** A project means the same thing regardless of how a turn starts.
4. **Authenticated state is server-authoritative and fail-closed.** A failed write stays visibly failed or retryable; it never becomes a server-looking local success.
5. **Completion is proven through the deployed browser and worker path.** Source inspection and substring tests are necessary gates, not release evidence.

The capability crosses two repository boundaries: `xeno-platform` owns schedules, runs, messages, Library retrieval, and the shared schema; `xeno-api-proxy` owns `/v1/chat/completions` dispatch and run-key caching; and `xeno-rt` owns the integrity-locked embedding runtime used by indexing and semantic queries. All three repositories, the embedding model artifact, and all three deployed commits are part of this delivery.

## 2. Problem statement

The implementation currently presents capabilities whose durable semantics are incomplete:

- `ChatWithLLM.tsx` loads and edits project instructions and project files, but ordinary generation does not consume either.
- `chatScheduledWorker.js` submits only `task.prompt`, so a scheduled project task is not project-aware.
- `chat_projects` is keyed only by `user_id`; workspace membership and ReBAC inheritance do not govern project resources.
- scheduled tasks advance `next_run_at` before execution but have no run record or idempotency key. A crash or retry can lose a run or duplicate a user message.
- daily, weekly, and monthly recurrences are implemented as elapsed-time arithmetic, which does not preserve a user's local time across daylight-saving changes.
- authenticated conversation creation can fall through to `convo-<timestamp>` after a database failure, despite downstream UUID-only APIs.
- artifacts, share state, customization, connectors/plugins, and some memory flows retain in-memory or fabricated-success fallbacks.
- share creation currently generates `/overview/office/word?share=...` although the application route is `/share/:token`, and the public share query exposes `system_prompt`; both violate the Chat share contract.
- current tests primarily prove source reachability. They do not prove database effects, context consumption, retry semantics, authorization isolation, browser reload, or live worker execution.
- the platform changes under discussion are local-only on `codex/overview-taskbar-edge-divider`, the gateway change does not exist at the recorded `xeno-api-proxy` baseline, and the embedding runtime is uncommitted on an isolated `xeno-rt` worktree; deployability of any final commit and the model bundle from their remote/artifact authorities is therefore not yet proven.

These are one architectural defect: the UI can represent a coherent project, but the backend does not yet own and execute that complete representation.

### 2.1 Gap-to-delivery traceability

| Confirmed gap | Owning sections | Completion proof |
|---|---|---|
| project instructions/files are display-only | 6, 9, 10, 11 | unique instruction and document fact affect interactive and scheduled answers with citations |
| conversation creation can fall back to `convo-*` | 14, 20, 21 | forced create failure produces no Recents entry or persisted-route call |
| schedules lack timezone, run history, retry safety, and live execution proof | 8, 13, 18, 20 | DST, concurrency, crash injection, run-history reload, and live worker occurrence |
| projects are personal owner rows rather than collaboration boundaries | 6, 8, 12 | complete ReBAC role matrix and cross-tenant denial |
| Library assets are not yet a reusable knowledge plane | 7–10, 17 | canonical asset relation, ingestion, hybrid retrieval, provenance, and preview |
| authenticated Chat subsystems can simulate success | 8, 11, 14 | server persistence plus failure injection for each subsystem |
| local commits and test records remain operationally incomplete | 16, 20–23 | remote clean-checkout deploy evidence; cleanup performed only with explicit authorization |
| shell/history equilibrium could regress as data becomes real | 15, 20 | browser matrix with navigation and right-side Library history open/closed |

## 3. Goals

The implementation SHALL:

- make project instructions and authorized project assets affect interactive and scheduled model turns;
- make every uploaded or generated file a canonical Library asset that can be reused across Chat and future XENO products;
- provide hybrid lexical and semantic retrieval with per-chunk provenance;
- preserve local recurrence intent using IANA time zones and explicit DST, overlap, and misfire policies;
- execute each scheduled occurrence with one durable logical run and exactly one committed conversation effect across crashes and retries; external inference is at-least-once until the XENO gateway honors the run idempotency key;
- expose durable run history, attempts, outcomes, and errors;
- support personal and workspace projects with existing ReBAC relationship tuples;
- remove authenticated fake-success paths from all in-scope Chat subsystems;
- preserve the intentional account-activation gate and all existing security boundaries;
- migrate existing project files and tasks without data loss;
- qualify the feature through focused tests, real PostgreSQL, a real worker, a production build, deployed HTTP probes, and authenticated browser hard reloads.

## 4. Non-goals

This work SHALL NOT:

- redesign the already-correct Chat shell geometry, model-selector animation, Library preview chrome, or right-side image history;
- replace the XENO model gateway or introduce a third-party hosted retrieval product;
- weaken `requireActivated`, workspace membership, account suspension, credit, or model-entitlement checks;
- delete intentional development-only fixtures used for explicit offline development;
- delete production or verification data without separate user authorization;
- introduce a second asset store inside Chat;
- treat a pushed branch as a production release without the repository's release/deploy gates.

## 5. Current-state evidence

### 5.1 Existing durable seams to retain

- `src/server/services/libraryAssets.js` owns `user_files`, signed content URLs, ownership checks, and Library registration. It is the canonical asset seam.
- `src/server/routes/libraryRoutes.js` already exposes authenticated previews and expiring cross-origin content links used for drag/export. The new authorization model must extend this seam rather than introduce a second delivery path.
- `src/server/database/migrations/20260825120000-chat-full-scale.sql` creates project, project-file, and scheduled-task records.
- That migration also creates `chat_artifacts`; `chat_shared_conversations` and its expiry/revocation fields already exist in the baseline schema and are extended rather than recreated.
- `src/server/routes/chatRoutes.js` contains the authenticated CRUD surface and currently resolves project files through `getManagedLibraryFile`.
- `src/server/utils/authzReBAC.js` implements direct grants, a human role hierarchy, and parent inheritance.
- `src/server/utils/workspaceContext.js` establishes the `x-xeno-workspace` request convention.
- `src/server/services/forumService.js` already demonstrates PostgreSQL lexical ranking that preserves exact-error-string retrieval; the project retriever should reuse this operating pattern rather than invent a second search dialect.

### 5.2 Defects to replace

- `src/components/playground/Chat/ChatWithLLM.tsx` returns `convo-${now}` when authenticated conversation creation fails.
- `src/server/workers/chatScheduledWorker.js` uses elapsed `+24h`/`+7d`/`setMonth` recurrence and submits only the stored prompt.
- `src/server/services/backgroundJobs.js` uses Redis list pop semantics without a visibility timeout or acknowledgement. It is not sufficient as the authority for durable scheduled runs.
- `src/components/playground/Chat/chatCustomize.ts`, `chatShare.ts`, and `chatArtifacts.ts` contain browser-memory state or local-success fallback branches.
- `src/components/playground/Chat/ChatShareModal.tsx` and `ChatGlobalSettingsPage.tsx` expose mock-state language.
- `src/server/routes/chatRoutes.js` builds Chat links for the Word editor and includes the conversation system prompt in its public share projection.
- `scripts/chat-subsystems-write.test.mjs` explicitly does not use a live database.

## 6. Product behavior

### 6.1 Project creation

A user creates either:

- a **personal project**, owned by the user and not attached to a workspace; or
- a **workspace project**, attached to the active workspace carried by `x-xeno-workspace`.

Creation must atomically persist the project row, owner or workspace-parent authorization tuple, audit event, and response. If the transaction fails, no project appears in the UI. The helper must not swallow tenancy-link failures.

### 6.2 Project instructions

Project instructions are durable, versioned project configuration. They apply to every new interactive or scheduled turn in the project. Changing instructions affects future turns only and does not mutate prior message history.

Instruction precedence is fixed:

1. platform safety and policy;
2. model/provider-required system instructions;
3. account-level custom instructions;
4. project instructions;
5. conversation-specific system prompt;
6. current task or user prompt.

Lower levels may add specificity but may not override higher-level safety or authorization constraints. The context manifest records which instruction revisions were used.

### 6.3 Project assets

Adding a file to a project creates a relation to a canonical Library asset. The project does not own another byte copy and does not own an independent extracted-text field. The UI displays ingestion state:

- `queued`;
- `quarantined`;
- `scanning`;
- `extracting`;
- `indexing`;
- `ready`;
- `unsupported`;
- `failed`.

Only `ready` assets participate in retrieval. `quarantined` and `scanning` render as a security-scan-pending state and cannot be downloaded by project members. A failed asset remains visible with a diagnostic and retry action. The Chat composer can still attach the original file directly when the selected model supports that media type after its scan is clean; retrieval state and direct attachment are distinct.

Lexical readiness and semantic readiness are separate axes. An asset with successful extraction remains `ready` and searchable lexically when vector infrastructure is absent or degraded; the UI may show a separate semantic-degraded diagnostic, but it must not relabel the usable lexical asset as failed or repeatedly re-extract its bytes.

### 6.4 Project conversations

Every project conversation stores `project_id` and inherits access from its project. Creating a conversation is a server write. Until the server returns a UUID, the client may show an explicitly typed `pending` draft, but it must not add it to durable Recents, call UUID routes, or label it saved.

### 6.5 Scheduled project turns

A schedule stores either one absolute occurrence or a local recurrence definition plus an IANA timezone. Each calculated occurrence creates one durable logical run. The run assembles the same project instructions and knowledge used by an interactive turn, executes under its current `run_as_user_id` authorization and entitlement, and writes one user/assistant message pair or one terminal failure record. If that principal is deleted, suspended, or loses project access, the run records a typed authorization failure and the task pauses; it never executes unscoped.

The UI exposes next occurrence, timezone, last outcome, attempt count, and run history. Pausing a task prevents future claims but does not delete history.

### 6.6 Sharing and collaboration

Workspace roles inherit through the project parent:

| Relation | Read project/chat/assets | Send messages | Add/remove assets | Edit project/schedules | Delete/manage access |
|---|---:|---:|---:|---:|---:|
| viewer/client | yes | no | no | no | no |
| reviewer | yes | yes | no | no | no |
| editor | yes | yes | yes | yes | no |
| admin/owner | yes | yes | yes | yes | yes |

Direct project grants remain possible through `relationship_tuples`. An agent receives only its explicit relation, consistent with the current ReBAC engine.

## 7. Target architecture

```text
Library upload / generated output
        |
        v
 user_files (canonical bytes + metadata + tenant)
        |
        +--> library_asset_ingestions --> extractor/OCR --> library_asset_chunks
        |                                             \--> lexical index
        |                                             \--> xeno-rt /v1/embeddings
        |                                                    |
        |                                                    v
        |                                          canonical vectors +
        |                                      project-scoped vector index
        |
        +--> chat_project_assets --> chat_projects --> conversations / schedules
                                                   |
                                                   v
                                   ChatProjectContextAssembler
                                     | authorize every source
                                     | merge instructions
                                     | hybrid retrieve + rank
                                     | enforce token budget
                                     v
                            interactive route OR scheduled-run worker
                                     |
                    interactive manifest | scheduled immutable run key
                                     v
                       xeno-api-proxy /v1/chat/completions
                         | run-key ledger in platform PostgreSQL
                         | provider dispatch + credit idempotency
                                     v
                              model result + citations
```

The database is the authority for assets, projects, schedules, runs, and completion state. Redis/Bull may wake workers and improve throughput, but a missing Redis job must not make a committed database run disappear.

## 8. Data model

Create immutable timestamp-named migrations after `20260825120000-chat-full-scale.sql`; never edit the deployed migration. Split them by deployable dependency boundary:

1. core tenancy, Library metadata/lexical ingestion, scheduler, and compatibility schema without `VECTOR`;
2. pgvector extension, embedding column, and model-specific index only after the database image and embedding contract qualify;
3. compatibility-column removal only after the observation and rollback window.

Each filename uses its implementation timestamp and the repository convention.

The migration runner must understand declared capability requirements such as `-- REQUIRES: pgvector>=0.8.6`. An unmet known requirement defers that migration without inserting a `schema_migrations` row; a later run applies it when the capability exists. Unknown or malformed requirements fail closed. Migration status/readiness reports the deferred version and requirement explicitly. Core migrations remain runnable and testable on plain PostgreSQL 15, while semantic migrations are applied only in the pinned pgvector matrix.

### 8.1 `chat_projects` changes

Add and backfill from the legacy `user_id`:

- `owner_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT`;
- `workspace_id UUID NULL REFERENCES workspaces(id) ON DELETE RESTRICT`;
- `instructions_revision BIGINT NOT NULL DEFAULT 1`;
- `created_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL`;
- `updated_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL`;
- `CHECK ((owner_user_id IS NULL) <> (workspace_id IS NULL))` so exactly one authority owns the project.

Add indexes on `(workspace_id, updated_at DESC)` and `(owner_user_id, updated_at DESC)`. A personal project has `owner_user_id` and no workspace; a workspace project has `workspace_id` and no personal owner. ReBAC is the request-time authorization authority after backfill. Existing rows migrate as personal projects. Creator/updater attribution is historical metadata, not ownership, and account deletion may null it without deleting a workspace project. The legacy `user_id` becomes nullable with `ON DELETE SET NULL`, is dual-written only for personal compatibility, and is removed after cutover; it is never used to authorize workspace rows.

Change `chat_conversations.project_id` to `ON DELETE RESTRICT`. Deleting a project must never turn a project conversation into an unscoped personal conversation through `ON DELETE SET NULL`.

The same migration must remove creator identity as child-resource authority. The baseline schema has `chat_conversations.user_id` and `chat_messages.user_id` as `NOT NULL ... ON DELETE CASCADE`; leaving those constraints intact would delete workspace/project history when its creator is erased. Add `chat_conversations.owner_user_id UUID NULL ... ON DELETE RESTRICT` plus nullable `created_by_user_id ... ON DELETE SET NULL`, and require `num_nonnulls(owner_user_id, project_id, workspace_id) = 1`. A project conversation derives workspace scope through its project parent rather than duplicating `workspace_id`. Backfill legacy personal rows to `owner_user_id`; normalize project/workspace rows only after authority checks. Make the legacy conversation/message `user_id` columns nullable with `ON DELETE SET NULL` and stop using them for authorization. Messages inherit the conversation and retain only nullable author attribution. Personal conversations are purged before personal-owner deletion; project/workspace conversations and their messages survive creator deletion. Compatibility columns are removed only after all callers use the authority tuple and attribution fields.

### 8.2 `chat_project_assets`

Replace the logical role of `chat_project_files` with:

- `id UUID PRIMARY KEY`;
- `project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE CASCADE`;
- `asset_id UUID NOT NULL REFERENCES user_files(id) ON DELETE RESTRICT`;
- `added_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL`;
- `retrieval_enabled BOOLEAN NOT NULL DEFAULT true`;
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`;
- unique `(project_id, asset_id)`.

Linking and unlinking run in the same transaction as the matching ReBAC tuple: `library_asset:<assetId>#parent@project:<projectId>`. An asset may have multiple project parents; authorization is the union of the owner's direct grant and all current authorized parents. Project removal deletes only the relation and its exact parent tuple. Asset deletion remains a Library operation and must refuse or explicitly resolve active project references.

Extend `user_files` rather than creating another asset table:

- add `owner_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT`, backfill it from legacy `user_id`, add `workspace_id UUID NULL REFERENCES workspaces(id) ON DELETE RESTRICT`, and require exactly one with `CHECK ((owner_user_id IS NULL) <> (workspace_id IS NULL))`;
- add `created_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL` so uploader attribution is not workspace-asset ownership;
- widen `file_size` from `INTEGER` to `BIGINT`;
- add `content_sha256 TEXT` and `replaces_asset_id UUID NULL REFERENCES user_files(id) ON DELETE SET NULL`;
- treat managed bytes as immutable. Replacing content creates a new asset ID, preserves provenance, and atomically swaps selected project relations; it never mutates bytes behind an existing signed or cited asset ID.

Existing rows backfill as personal assets and receive `library_asset:<id>#owner@user:<id>`. A new upload/generated output made in workspace scope is workspace-owned only after the caller confirms that scope and has `editor`; its registration writes `library_asset:<id>#parent@workspace:<id>` in the same transaction. Otherwise it is personal. Explicitly sharing a personal asset into a workspace project grants access but does not transfer ownership. An explicit transfer operation atomically changes the exclusive owner/workspace columns and matching ownership/parent tuple without copying bytes, with personal-owner plus workspace-owner/admin authorization and an audit event.

`registerManagedLibraryFile` MIME-sniffs and hashes the stored bytes before the row becomes usable. Uploaded and generated binaries must all receive a managed `user_files` row. Domain-specific generation tables retain job/provenance metadata and reference the canonical asset; they do not remain a parallel byte authority. The legacy `user_id` becomes nullable with `ON DELETE SET NULL`, remains a temporary personal-asset compatibility column, and is removed after all Library routes and union queries use `owner_user_id`/workspace authorization.

Create `library_asset_link_grants` for revocable bearer delivery:

- `id UUID PRIMARY KEY`;
- `asset_id UUID NOT NULL REFERENCES user_files(id) ON DELETE CASCADE`;
- `issued_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL`;
- `authorizing_resource_type TEXT NOT NULL` with a `CHECK` for `user`, `project`, or `workspace`;
- `authorizing_resource_id UUID NOT NULL`;
- `expires_at TIMESTAMPTZ NOT NULL`, `revoked_at TIMESTAMPTZ NULL`, and `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`.

The signed URL carries the grant ID, expiry, and HMAC signature, never raw storage metadata. Each content request verifies the signature and live grant row, then re-checks that its authorizing owner/project/workspace relationship still grants the asset. Revocation or unlink therefore invalidates an already-issued project capability immediately; expiry remains the fallback bound.

### 8.3 `library_asset_ingestions`

Store one ingestion per asset content revision:

- `id UUID PRIMARY KEY`;
- `asset_id UUID NOT NULL REFERENCES user_files(id) ON DELETE CASCADE`;
- `content_sha256 TEXT NOT NULL`;
- `mime_type TEXT NOT NULL`;
- `state TEXT NOT NULL` with a database `CHECK` for the states in section 6.3;
- `extractor_id TEXT`, `extractor_version TEXT`;
- `embedding_model_id TEXT`, `embedding_dimensions INTEGER`;
- `semantic_status TEXT NOT NULL` checked to `disabled`, `pending`, `indexing`, `ready`, or `degraded`;
- `semantic_attempt_count INTEGER NOT NULL DEFAULT 0`, `semantic_error_code TEXT`, and sanitized `semantic_error_message TEXT`;
- `attempt_count INTEGER NOT NULL DEFAULT 0`;
- `error_code TEXT`, `error_message TEXT`;
- `started_at`, `completed_at`, `created_at`, `updated_at` as `TIMESTAMPTZ`;
- a deduplication unique constraint over `(asset_id, content_sha256, extractor_version, embedding_model_id)` using `NULLS NOT DISTINCT`, so lexical ingestions with a null embedding model cannot duplicate.

### 8.4 `library_asset_chunks`

Store:

- `id UUID PRIMARY KEY`;
- `ingestion_id UUID NOT NULL REFERENCES library_asset_ingestions(id) ON DELETE CASCADE`;
- `asset_id UUID NOT NULL REFERENCES user_files(id) ON DELETE CASCADE`;
- `ordinal INTEGER NOT NULL`;
- `content TEXT NOT NULL`;
- `token_count INTEGER NOT NULL`;
- `search_vector TSVECTOR NOT NULL`;
- `embedding VECTOR` only in the separate pgvector migration after the extension is qualified;
- `embedding_model_id TEXT`;
- `source_locator JSONB NOT NULL DEFAULT '{}'` for page, sheet, slide, heading, line, timestamp, or region;
- unique `(ingestion_id, ordinal)`.

Use a GIN index on `search_vector`. The canonical chunk vector remains on `library_asset_chunks`. The semantic index must be model-specific and cast to the locked dimension, because unbounded `vector` permits model evolution while an HNSW index requires one dimension. The release migration SHALL name the active embedding model and dimension explicitly. Semantic indexing and semantic-query readiness fail closed if application configuration, runtime response metadata, and database index metadata disagree; the API and scheduler may remain available only in the explicit lexical-only degraded mode described below.

Create `chat_embedding_contracts` as the database-readable active contract, including model ID, revision, dimensions, pooling, normalization, pgvector version, HNSW parameters, recall threshold, tenant strategy, and partition count. Exactly one row may be active. Runtime readiness and semantic workers validate that row before indexing or querying; a mismatch degrades to lexical-only and blocks semantic backfill rather than writing mixed vectors.

For project retrieval, create `chat_project_chunk_embeddings` as a derived index relation containing only `project_id`, `chunk_id`, `asset_id`, model identity, vector, and timestamps—never extracted content. It has a composite foreign key to `chat_project_assets(project_id, asset_id)` so unlinking or deleting the project relation removes the derived entries, and chunk deletion cascades. Initial migration backfill, successful semantic ingestion, project linking, unlinking, reindexing, and model cutover must keep it synchronized idempotently. The canonical vector and ingestion state remain Library-owned; this table is a query accelerator, not a second knowledge authority.

Tenant predicates on an approximate HNSW query are correctness-sensitive because pgvector applies ordinary filtering after the approximate index scan and can otherwise return too few authorized candidates. The locked first implementation uses 64-way hash partitioning by `project_id` plus pgvector 0.8.6 strict iterative HNSW scans; partition pruning is a performance bound, not authorization and not complete tenant isolation. Different projects can hash to the same partition, so qualification must deliberately place a much larger unauthorized project in the same partition as the authorized project and compare HNSW results with exact-vector ground truth. The SQL must carry the exact project predicate and current parent relation before results leave PostgreSQL, and request-time ReBAC remains the authorization boundary. It must never fetch cross-tenant candidates into application memory and filter them there. The selected partition count, `hnsw.ef_search`, scan bounds, recall target, and observed query plan are part of the locked model/index contract.

### 8.5 Scheduled task changes

Add to `chat_scheduled_tasks`:

- `project_id` and `conversation_id` foreign keys changed to `ON DELETE RESTRICT`;
- `created_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL`;
- `run_as_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL`;
- `schedule_kind TEXT NOT NULL` with a `CHECK` for `once` or `recurring`;
- `timezone TEXT NOT NULL` containing an IANA name;
- `timezone_source TEXT NOT NULL` (`user_confirmed`, `legacy_default_utc`);
- `dtstart_local TIMESTAMP NOT NULL`;
- `rrule TEXT NULL` using the RFC 5545 recurrence grammar, required only for `schedule_kind='recurring'` by a database `CHECK`;
- `misfire_policy TEXT NOT NULL DEFAULT 'run_once'` (`skip`, `run_once`, `catch_up`);
- `overlap_policy TEXT NOT NULL DEFAULT 'skip'` (`skip`, `queue_one`);
- `max_catch_up_runs INTEGER NOT NULL DEFAULT 1` and a bounded `catch_up_window_seconds`;
- `max_attempts INTEGER NOT NULL DEFAULT 3`;
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`.

Keep `next_run_at` as a materialized UTC claim field. Extend task state with `cancelled` and `needs_review`, or represent those as explicit paused reasons; the API must distinguish them. `cadence` and `cadence_label` remain temporary compatibility columns until every row and client has migrated, then are removed in a later migration.

Backfill both attribution/principal columns from legacy `user_id`, write the task's direct owner/parent tuple, then make legacy `user_id` nullable with `ON DELETE SET NULL`. It remains a temporary compatibility field, not the authorization authority, and is removed after cutover. A null `run_as_user_id` can exist only after principal deletion and forces the task into a paused `principal_missing` state.

### 8.6 `chat_scheduled_runs`

Create:

- `id UUID PRIMARY KEY`;
- `task_id UUID NOT NULL REFERENCES chat_scheduled_tasks(id) ON DELETE CASCADE`;
- `occurrence_key TEXT NOT NULL` (`scheduled:<utc-instant>` or `manual:<uuid>`);
- `scheduled_for TIMESTAMPTZ NOT NULL`;
- `status TEXT NOT NULL` (`pending`, `leased`, `running`, `succeeded`, `failed`, `cancelled`, `skipped`, `reconciliation_required`) with a database `CHECK`;
- `attempt_count INTEGER NOT NULL DEFAULT 0`;
- `lease_owner TEXT`, `lease_expires_at TIMESTAMPTZ`;
- `conversation_id UUID REFERENCES chat_conversations(id)`;
- `context_manifest JSONB` containing authorized resource IDs, revisions, locators, token allocation, and content digests only; no raw chunks, prompts, hidden policy, or signed URLs;
- `model_id TEXT`, `provider_request_id TEXT`;
- `result_staging JSONB` for a completed provider result not yet published as messages;
- `error_code TEXT`, `error_message TEXT`;
- timestamps for creation, start, completion, and update;
- unique `(task_id, occurrence_key)`.

The unique key is the logical-run idempotency boundary.

Add `chat_messages.scheduled_run_id UUID NULL REFERENCES chat_scheduled_runs(id) ON DELETE SET NULL` and a partial unique index on `(scheduled_run_id, role)` for scheduled `user` and `assistant` roles. Do not add circular message-ID foreign keys back onto the run. Before adding the existing missing uniqueness guarantee on `(conversation_id, message_index)`, audit and repair duplicates. Scheduled publishing locks the conversation row or uses one atomic index allocator, then inserts both roles and completes the run in one transaction.

### 8.7 Server-authoritative Chat settings

Persist the remaining browser-only state through existing canonical records where they exist and focused tables where they do not:

- extend `user_settings.settings.chat` through a versioned, server-validated schema for account instructions, selected persona, and memory settings;
- retain `chat_personas` as the authority for persona definitions; account profile edits use the canonical account/profile service rather than a Chat-owned copy;
- create account-scoped `chat_connector_connections` with `id`, `user_id ON DELETE CASCADE`, catalog `connector_key`, checked state (`pending`, `connected`, `expired`, `failed`, `revoked`), validated scopes, `sealed_credentials`, expiry/last-verification/error fields, timestamps, and unique `(user_id, connector_key)`. Secret-bearing columns use the existing `secretBox.encrypt`/`decrypt` boundary, have a `CHECK` matching the `v1.` envelope, and fail with 503 when `SECRET_BOX_KEY` is unavailable; never reuse provider-only `user_provider_credentials` or put secrets in `user_settings`;
- create account-scoped `chat_plugin_installations` with `id`, `user_id ON DELETE CASCADE`, immutable Marketplace `listing_id` and installed `version`, checked enabled state, server-validated non-secret `configuration JSONB`, entitlement reference/status, timestamps, and unique `(user_id, listing_id)`. Do not duplicate plugin manifest/catalog metadata or store secrets in configuration;
- extend the existing `chat_artifacts` table with `owner_user_id`, project/workspace parent fields, nullable creator attribution, and an exactly-one-authority check while preserving its current version field. Replace its baseline `user_id NOT NULL ... ON DELETE CASCADE` creator dependency so deleting a project/workspace artifact's creator does not delete the shared artifact;
- treat conversation-scoped `chat_skills` the same way: add explicit nullable personal-owner authority for account-only skills, while a conversation-scoped skill inherits its conversation under an exactly-one-authority check. Its baseline creator `user_id` must not cascade-delete a skill that belongs to a retained project conversation;
- extend existing `chat_shared_conversations` with `visibility TEXT NOT NULL` checked to `public` or `workspace`, plus `workspace_id UUID NULL REFERENCES workspaces(id) ON DELETE RESTRICT` required exactly for workspace visibility. Add `token_digest TEXT` and migrate lookup to SHA-256 of the high-entropy bearer token; return the raw token only at creation. Backfill digests from the temporary plaintext `share_token`, dual-read during rollback, then remove plaintext only in the later cleanup migration. Existing token shares backfill as `public`; not sharing is represented by no active share row. Active state is computed from `revoked_at` and `expires_at`, not duplicated as a mutable boolean.

Connector definitions come from a checked-in/server-owned catalog with a real OAuth or API-key verification contract, approved redirect URI, and exact scopes per connector. If no connector or plugin is qualified or installed, the production UI renders an honest empty state; it never fabricates catalog rows or a connected installation.

### 8.8 Interactive context handoff and message manifests

Interactive citations need a server-owned persistence boundary; accepting a client-supplied manifest would let a caller forge asset IDs, locators, or instruction revisions. Create:

- `chat_generation_contexts`: a short-lived, single-use record keyed by an opaque UUID and bound to the authenticated user, conversation, project, request hash, redacted manifest, safe source projection, creation/expiry, and `consumed_at`. It contains no raw chunks, hidden policy, signed URLs, or credentials;
- `chat_message_context_manifests`: one immutable private manifest per persisted assistant message, linked by message ID and containing the authorized project/instruction revisions, selected asset/chunk IDs, locators, token allocation, and content digests. It is never selected by the public-share projection.

The generation route creates the handoff record before returning and sends the browser only its opaque ID plus the safe source projection. Assistant-message persistence consumes that ID in the same transaction as the message insert, verifies user/conversation/project/request binding and expiry, rejects reuse, and copies the private manifest to the message record. Scheduled publishing writes the same message-manifest shape directly from its server-owned run manifest. The server maps model citation ordinals only to sources actually selected in that manifest; unknown or forged citation ordinals are not rendered as Library links.

### 8.9 Gateway run-key ledger

The platform migration creates `chat_gateway_run_requests`, but the table is written only by `xeno-api-proxy` through its existing `PLATFORM_DATABASE_URL` connection:

- `run_key UUID PRIMARY KEY REFERENCES chat_scheduled_runs(id) ON DELETE CASCADE`, equal to the immutable `chat_scheduled_runs.id`, so an invented key cannot create an orphan ledger row and final deletion follows authoritative run retention;
- `user_id UUID NOT NULL`, the immutable canonical platform principal captured for the run. This retained identifier must not have an `ON DELETE CASCADE` user foreign key: deleting a user must not erase the run-key binding while the authoritative run is retained. If a foreign key is used, account erasure must first purge the authoritative run under the same retention transaction; otherwise store the UUID as retained run audit data without a user-row dependency;
- `request_hash TEXT NOT NULL`, computed from the canonical response-affecting request body and bound to the principal;
- `attempt INTEGER NOT NULL`, `status`, downstream-dispatch marker/timestamp, provider request ID, cached HTTP status/body, timestamps, and expiry;
- states that distinguish `pending`, `completed`, `retryable_failed`, `reconciliation_required`, and `expired`; constraints prevent a completed row without a cached response and prevent an expired tombstone from carrying a cached response body.

`xeno-api-proxy` receives the key on non-streaming `POST /v1/chat/completions` as `x-xeno-run-key`. It inserts/locks the row before downstream dispatch. The same key plus a different principal or request hash is a 409 conflict. A completed response returns the original HTTP status and semantically identical JSON body with no provider call and no second usage/credit charge. A failure known to occur before downstream acceptance is retryable on the same logical run; a timeout/crash after possible acceptance becomes `reconciliation_required` and requires an explicit warned manual acknowledgement (`x-xeno-run-retry: acknowledged`). The gateway records whether downstream dispatch began so transient pre-dispatch errors are not misclassified as ambiguous provider spend.

Before creating the ledger row, the gateway must read the authoritative scheduled run and task through its least-privilege platform connection, require that the run is eligible for dispatch, and prove that the authenticated principal equals the task's current `run_as_user_id`. A missing run, an arbitrary UUID, a mismatched principal, or a non-scheduler caller cannot reserve or poison a run key. This check is required in addition to the foreign key because a known real run ID is not itself dispatch authority.

Expose that check through a narrowly scoped database function or view that returns only dispatch eligibility and principal binding; do not grant the gateway broad `SELECT` over scheduled-task prompts, context manifests, or conversation data. If implemented as `SECURITY DEFINER`, pin its `search_path`, own it with a non-login migration role, revoke `PUBLIC`, validate UUID inputs, and grant only `EXECUTE` to the gateway runtime role.

Cached response bodies are retained for seven days and that window must exceed the automatic lease/retry horizon. Expiry must not erase the only binding between run key, principal, request hash, and prior dispatch. The bounded sweep clears cached status/body and sensitive provider metadata and transitions a terminal row to an `expired` tombstone; it does not delete the run-key row while the authoritative scheduled run is retained. A replay of an expired key without an explicit warned acknowledgement returns `run_cache_expired` and performs no provider or credit call. An acknowledged manual retry may increment the attempt on the same bound row, but a mismatched principal/hash still conflicts. Final deletion occurs only with the retention/erasure of the authoritative scheduled run or a longer separately proven idempotency window, so automatic redispatch cannot become possible merely because response retention elapsed.

The gateway database principal receives only `SELECT`, `INSERT`, and the narrowly required `UPDATE` privileges on the run-key table, plus `EXECUTE`/`SELECT` on the narrow run-authorization boundary above, in addition to its existing canonical account/credit permissions. It receives no broad scheduled-task or conversation read. Ordinary runtime operation does not require `DELETE`; retention/erasure uses a separately scoped maintenance principal. Scheduled execution remains disabled until this schema, gateway behavior, credit-idempotency and expiry-tombstone tests, least-privilege grants, and deployed gateway health are all proven.

## 9. Library ingestion pipeline

Implement Library-owned services under `src/server/services/library/`:

- `assetIngestionService.js` — state machine, deduplication, retry, and diagnostics;
- `assetExtractors.js` — MIME-sniffed extractor registry;
- `assetChunker.js` — deterministic structured chunking;
- `xenoEmbeddingService.js` — XENO-owned embedding-runtime adapter and exact response-contract validator;
- `assetRetrievalService.js` — tenant-filtered lexical/semantic retrieval;
- `assetProvenance.js` — signed source locator and display metadata.

Supported launch formats:

| Class | Extractor requirement |
|---|---|
| plain text, Markdown, code, JSON, CSV, HTML | bounded streaming text decode with encoding detection |
| DOCX | `mammoth`, preserving headings and table cells in locators |
| PDF | server-side text extraction; OCR fallback for image-only pages through the XENO processing/runtime boundary |
| images | dimensions/metadata immediately; OCR and vision description only when enabled and available |
| audio/video | metadata immediately; transcript indexing only through an explicit XENO transcription capability |

Extension is not trusted as MIME. Every extractor enforces byte, page, decompression, CPU-time, and output-size limits. Active content, macros, scripts, external references, and archive traversal are never executed.

Ingestion is idempotent by content digest and parser/model version. Because managed bytes are immutable, replacement creates a new canonical asset and ingestion; old manifests remain available for audit until retention removes them.

Extraction runs only after mandatory malware scanning. Until the scanner succeeds, an asset is quarantined and unavailable to project members, extraction, or cross-account download. The extractor runtime is non-root, network-disabled, read-only except for a bounded temporary volume, and has explicit CPU, memory, wall-time, decompression, and output limits. Phase 0 locks the scanner implementation; scanner absence is fail-closed, not a reason to skip scanning.

## 10. Retrieval and context assembly

Create `src/server/services/chatProjectContext.js` with one public operation:

```js
assembleProjectContext({
  db,
  principal,
  workspaceId,
  projectId,
  conversationId,
  query,
  modelId,
  maxInputTokens,
})
```

The service SHALL:

1. authorize `viewer` on the project and conversation;
2. load the exact instruction revisions;
3. select only `retrieval_enabled` and `ready` project assets;
4. re-check authorization on every asset before reading chunks;
5. run lexical retrieval with PostgreSQL `tsvector` ranking;
6. run vector retrieval using the XENO embedding model when available;
7. fuse result ranks using Reciprocal Rank Fusion, then deduplicate overlapping chunks;
8. reserve tokens for policy, history, user input, and response before allocating retrieval tokens;
9. return content blocks and a provenance manifest;
10. emit metrics without logging source contents or prompts.

Lexical retrieval is mandatory and never removed when semantic retrieval is enabled; exact identifiers and error messages require it. Semantic retrieval failing degrades explicitly to lexical-only and records a diagnostic. Authorization, database, or project lookup failure does not degrade to unscoped chat.

Extracted content, filenames, and locators are untrusted data. Serialize retrieved chunks in delimited data-only blocks; never promote them to system/tool instructions or execute tools solely because retrieved content requests it. Sanitize display metadata and add adversarial prompt-injection fixtures. Direct attachments use the same asset authorization boundary.

Delimiters alone are not a tool-security boundary. Retrieved content can never add to the request's tool allowlist or grant tool scope. A model tool call is only a proposal: the server-side executor verifies that the product/caller enabled that tool for this turn, reauthorizes its concrete resources, validates arguments, and records the action. Surfaces without an authorized tool-execution loop ignore/reject tool-call output. The malicious-document test injects both natural-language instructions and a mock model tool-call response and proves that no side effect occurs without independently authorized caller intent.

The same function is called by the interactive generation route and scheduled-run worker. No UI caller may assemble project knowledge independently.

## 11. API contract

Retain `/api/chat` as the public namespace and add or normalize these endpoints:

### 11.1 Projects and access

- `POST /projects` — atomic personal/workspace project creation;
- `GET /projects` — authorized personal and active-workspace projects;
- `GET /projects/:id` — project plus caller capabilities;
- `PATCH /projects/:id` — editor; increments instruction revision when instructions change;
- `DELETE /projects/:id` — admin/owner; soft-archives the project, cancels/pauses future schedules, and returns 404 when no authorized row was affected. Physical purge is a separate retained-data operation after the configured window;
- `GET /projects/:id/access` — owner/admin lists direct grants plus inherited effective capabilities;
- `PUT /projects/:id/access/:subjectType/:subjectId` — owner/admin creates or replaces a validated direct relation;
- `DELETE /projects/:id/access/:subjectType/:subjectId` — owner/admin revokes the direct relation;
- `GET /projects/:id/assets`;
- `POST /projects/:id/assets` with `{ asset_id }`;
- `DELETE /projects/:id/assets/:assetId`;

Library owns ingestion and content delivery outside the Chat namespace:

- `POST /api/library/assets/:assetId/ingestions/retry`;
- `POST /api/library/assets/:assetId/transfer` with `{ workspace_id }` — explicit audited ownership transfer by the personal owner plus workspace owner/admin; no implicit transfer on project link;
- existing `GET /api/library/assets/:assetId/content` and `POST /api/library/assets/:assetId/link` continue through an authorization-aware Library helper.

Retain `/api/chat/projects/:id/files` compatibility aliases during client cutover. They call the same asset-relation service and return deprecation headers; no dual write or second file implementation is allowed.

### 11.2 Schedules and runs

- `POST /scheduled-tasks` with `schedule_kind`, confirmed `timezone`, `dtstart_local`, nullable `rrule`, bounded policies, and project/conversation IDs;
- `PATCH /scheduled-tasks/:id`;
- `DELETE /scheduled-tasks/:id` — soft-cancels future occurrences and retains run history until retention purge;
- `GET /scheduled-tasks/:id/runs?cursor=`;
- `POST /scheduled-tasks/:id/run-now` — creates a unique manual occurrence ID;
- `POST /scheduled-runs/:id/retry` — creates/claims another attempt on the same logical run, not another logical occurrence.

### 11.3 Context observability

- model responses include safe structured source references `{ asset_id, chunk_id, locator, display_name }`;
- interactive generation also returns an opaque, short-lived `project_context_id`; assistant persistence accepts that ID, never a browser-authored manifest, and consumes it once under the binding rules in section 8.8;
- no public context-debug endpoint ships in this scope. Tests and operations read a stored, redacted manifest through internal database/observability tooling; hidden system policy, raw chunks, signed URLs, and secrets are never returned;
- the browser renders sources as Library preview links through the existing preview route.

### 11.4 Shares and existing subsystem routes

- retain `POST /conversations/:id/share`, `GET /conversations/:id/shares`, `GET /share/:token`, and `POST /share/:token/accept`, adding validated visibility/expiry and ReBAC checks;
- normalize single-share revocation to `DELETE /conversations/:id/shares/:shareId`; keep the existing all-active-share revoke route as a compatibility alias with explicit semantics;
- build returned links from the configured canonical public origin as `/share/:token`, matching `App.tsx`; never derive a Word/Office route or trust an unvalidated forwarded host;
- serialize public shares through an allowlist of visible title/model and user/assistant message content. Structured message parts are filtered, and legacy plaintext/Markdown content is sanitized so embedded internal Library routes, signed asset URLs, attachment metadata, private asset/chunk IDs, and context-debug payloads cannot bypass the column allowlist. Never return or copy `system_prompt`, hidden policy, context manifests, provider metadata, or internal errors;
- share-list responses return metadata and revocation/expiry state but never the raw bearer token after creation. Copying a lost token requires an explicit rotate/reissue operation that revokes the prior token; the UI must not synthesize a URL from a digest;
- workspace-visible share reads require current workspace membership. Public bearer reads receive only the allowlisted conversation projection, and attachments/sources follow the separate asset-capability rule in section 12;
- retain the existing persona, artifact, skill, and memory route shapes, replacing owner-column-only checks with ReBAC where those records inherit a project and preserving owner checks for account-only records;
- add connector catalog/connection and plugin catalog/installation routes only after their Phase 0 contracts are locked. Mutation failure returns the error contract and no locally fabricated installation.

All IDs are validated as UUIDs before SQL. Every mutation uses `RETURNING` and rejects zero affected rows. Errors use stable machine codes and do not return fabricated objects.

### 11.5 Error contract

| HTTP | Code | Meaning/client behavior |
|---:|---|---|
| 400 | `invalid_resource_id`, `invalid_timezone`, `invalid_recurrence` | reject before SQL; keep editable input |
| 401 | existing authentication code | preserve sign-in return path |
| 403 | `account_not_activated` or existing entitlement code | preserve the current gate; do not substitute fixtures |
| 404 | `project_not_found`, `asset_not_found`, `schedule_not_found` | also used for unauthorized object IDs to prevent enumeration |
| 409 | `asset_already_linked`, `run_already_exists`, `schedule_overlap` | refresh authoritative state and explain the conflict |
| 422 | `asset_unsupported`, `asset_not_ready` | show durable ingestion state and remediation |
| 503 | `context_unavailable`, `model_unavailable`, `worker_unavailable` | retain draft/run and expose retry; never run unscoped |
| 500 | `persistence_failed` | no fabricated object; emit correlated server diagnostic |

## 12. Authorization and tenancy

All project, asset, conversation, schedule, run, artifact, and share operations use `authzReBAC.check` on the concrete resource. Owner-column predicates are migration aids, not the final authorization model.

Workspace project creation performs, in one transaction:

1. validate `x-xeno-workspace` as a UUID;
2. require at least `editor` on `workspace:<id>`;
3. insert `chat_projects.workspace_id`;
4. write `project:<id>#parent@workspace:<id>`;
5. write audit record;
6. commit.

Personal project creation writes `project:<id>#owner@user:<id>` in the same transaction. Child resources receive `#parent@project:<id>`, so they inherit project access rather than independently trusting the active-workspace header.

Replace best-effort `tagResourceWorkspace` use for these resources with a transactional variant that throws and rolls back on tuple failure. Deny by default, validate authorization on every request, and apply the same checks to content/download URLs. This matches OWASP's authorization guidance.

Cross-tenant asset linking is forbidden even if the caller knows an asset UUID. Linking an authorized personal asset into a workspace project is the explicit share action: the transaction creates `chat_project_assets` and `library_asset:<assetId>#parent@project:<projectId>`. Unlinking removes only that relation and tuple. Replace owner-only reads in project flows with `getAuthorizedLibraryFile(db, principal, assetId)`, which evaluates the owner's direct relationship plus all project parents; `getManagedLibraryFile` remains the strict owner helper for owner-only maintenance.

Signed content-link issuance reauthorizes the caller and binds the capability to the authorizing grant/project, expiry, and audience. Existing owner-bound v1 links remain compatible for personal assets; a new capability version carries a revocable grant ID or project scope so owner identity is not mistaken for workspace authorization. Same-origin previews use session authentication plus ReBAC. Drag/export continues to use `/api/library/assets/:id/link` and supplies `text/uri-list` and `DownloadURL`; the URL works cross-origin only until expiry or revocation.

Public conversation shares do not grant private Library access by default. Shared responses may expose sanitized source labels, but bytes require a separate explicit asset-share capability. Workspace/team shares require current membership on every request.

## 13. Durable scheduler design

### 13.1 Recurrence

Use a direct, pinned RFC 5545-compatible recurrence dependency, not the current transitive packages or manual millisecond arithmetic. Store `DTSTART` as local wall-clock time plus an IANA timezone and store `RRULE` separately for recurring schedules. Calculate `next_run_at` in UTC from those values. Daily 09:00 in `Europe/Berlin` remains 09:00 before and after DST.

Define edge behavior:

- a one-shot or initial `DTSTART` that names a nonexistent local time is interpreted with the UTC offset before the gap under RFC 5545 DATE-TIME handling (for example, 02:30 becomes 03:30). In contrast, a nonexistent local time generated by an `RRULE` is ignored and not counted in the recurrence set, as RFC 5545's recurrence rule requires; it is not shifted to 03:30;
- repeated local time during fall-back: execute the first occurrence once;
- month-day absent in a month: skip that month, consistent with RFC recurrence expansion;
- clock downtime: apply the stored misfire policy, with `catch_up` bounded by both `max_catch_up_runs` and `catch_up_window_seconds` so recovery cannot create an unbounded run storm;
- active prior run: apply the stored overlap policy.

### 13.2 Claim transaction

Within one transaction, the dispatcher:

1. selects due task rows ordered by `next_run_at, id` using `FOR UPDATE SKIP LOCKED`;
2. inserts `chat_scheduled_runs(task_id, occurrence_key, scheduled_for)` with `ON CONFLICT DO NOTHING`;
3. computes and updates the task's next occurrence;
4. commits;
5. signals the worker.

`SKIP LOCKED` is only a multi-dispatcher contention tool. The unique run row is the correctness boundary.

### 13.3 Lease and execution

Workers claim pending or expired-leased run rows with a bounded lease. A heartbeat extends the lease. Execution steps are resumable:

1. verify task remains active and principal is usable;
2. authorize project/conversation and current model entitlement;
3. assemble context and persist the context manifest;
4. call `xeno-api-proxy`'s non-streaming `/v1/chat/completions` with the immutable run ID in `x-xeno-run-key`. The gateway follows section 8.9, persists the key before downstream dispatch, and returns a cached accepted result on retry when one exists;
5. persist the returned assistant payload in `result_staging` before publishing it;
6. in one transaction, lock/allocate the next message indexes, insert the user and assistant messages once with `scheduled_run_id`, clear staging, and mark the run succeeded.

On retry, the worker resumes from the durable step: a staged result is published without another provider call, and already-published messages are returned without another write. External inference is at-least-once unless the downstream provider offers native idempotency or request reconciliation. A cached gateway hit never repeats platform usage/credit accounting. If the gateway crashes or times out after ambiguous downstream acceptance and cannot reconcile, the run becomes `reconciliation_required` and is not automatically dispatched again; a manual retry must warn that another provider charge may occur and persist that acknowledgement before the gateway header is sent. The committed conversation effect remains exactly once.

After `max_attempts`, mark the run `failed`, retain the error, and continue future occurrences unless policy or authorization requires pausing the task. No prompt or source content is written to application logs.

## 14. Server-authoritative client behavior

Refactor Chat client services so every async mutation has explicit states: `idle`, `saving`, `saved`, `failed`. Apply optimistic UI only when a compensating rollback is implemented and the item is visibly pending.

### 14.1 Conversation creation

- remove the authenticated `convo-${now}` fallback;
- use a distinct `PendingConversation` TypeScript type without an `id` field accepted by persisted-conversation functions;
- add to Recents only after the server returns a UUID;
- preserve draft text and attachments on failure;
- show Retry and Copy actions.

### 14.2 Remaining subsystems

Replace in-memory stores and fallback-success branches in:

- `chatCustomize.ts`;
- `chatShare.ts`;
- `chatArtifacts.ts`;
- memory generation-from-chats state;
- connector and plugin enablement.

Development fixtures stay behind an explicit `import.meta.env.DEV` adapter selected at application bootstrap. Production builds must contain a testable invariant that authenticated services cannot import or call the fixture adapter.

Share creation failure does not produce a URL. Artifact creation failure does not add an artifact. Connector failure does not show connected. Preference failure restores the previous value. Memory generation failure stays failed and retryable.

## 15. Frontend requirements

Extend the existing layouts; do not fork them.

- Project overview shows instructions revision, assets with ingestion status, chats, schedules, and members/capabilities.
- The composer displays the active project and selected model without adding a second independent model selector.
- Retrieved sources render beneath the assistant response and open the existing Library preview with right-side history.
- Library images and generated outputs open through that same preview from any conversation. Authorized drag/export obtains a fresh signed URL and populates browser-standard `text/uri-list` and `DownloadURL` payloads; Chat never drags an owner-only internal storage path.
- Schedule editor requires timezone, renders a human-readable next five occurrences, and surfaces DST behavior before save.
- Schedule detail displays run status, scheduled time, start/completion, attempt count, model, and sanitized error.
- Viewer-only users see disabled mutation controls with accessible explanations.
- All panels continue to account for expanded/collapsed Overview navigation and right-side Library history.
- Loading uses stable skeleton geometry; failed content never collapses into mock content.
- Keyboard navigation, focus restoration, screen-reader status announcements, reduced motion, and narrow viewport behavior are release gates.

## 16. Migration and backfill

Execute in compatible phases:

1. **Core schema expansion:** add tenancy, asset metadata, lexical-ingestion, scheduler, and compatibility schema without pgvector or removals.
2. **Project ownership backfill:** copy each existing `chat_projects.user_id` into `owner_user_id`, convert every existing project into personal scope, write direct owner tuples, and attach child-resource parent tuples. Backfill conversation/message/artifact/skill creator attribution, assign exactly one personal/project/workspace authority path to each retained resource, and replace creator-cascading foreign keys before creator deletion can erase shared history. Change conversation/task project foreign keys to `RESTRICT` only after orphan and authority checks pass. Keep legacy columns nullable for compatibility until removal.
3. **Canonical asset backfill:** copy existing `user_files.user_id` into `owner_user_id`, write each direct owner tuple, hash/sniff managed bytes, then resolve each `chat_project_files.storage_key` through `getManagedLibraryFile`, create `chat_project_assets` plus its parent tuple, and enqueue ingestion. Create managed `user_files` rows/mappings for resolvable generated images and other binary Library union members that currently lack an asset ID. Domain rows retain provenance and reference the asset. Unresolved bytes go to a migration exception table/report; they are not silently dropped. Keep the legacy owner column nullable for compatibility until removal.
4. **Schedule backfill:** copy legacy `user_id` into `created_by_user_id` and `run_as_user_id`, write direct owner/parent tuples, and make the legacy field nullable compatibility state. Preserve each existing `next_run_at` as the first absolute occurrence. Because no canonical stored timezone currently exists, recurring legacy rows use `UTC`, set `timezone_source='legacy_default_utc'`, pause as `needs_review` when wall-clock intent cannot be proven, and notify the user. New schedules require browser-detected IANA timezone confirmation and, if accepted, save it under the versioned `user_settings.settings.locale.timezone` schema. Convert known cadence values into `DTSTART`/`RRULE` and compare the first three occurrences with legacy intent.
5. **Generated-output cutover:** require every new uploaded or generated binary to register a canonical `user_files` asset before it is exposed in Chat or Library; report and block parallel-byte-authority writes.
6. **Dual read:** new services prefer normalized rows and read legacy rows only for recorded exceptions.
7. **Pgvector migration:** after infrastructure qualification, add the extension, embedding column, and locked-dimension partial expression index; lexical retrieval remains available throughout.
8. **Cutover:** make new columns/checks required where appropriate and stop legacy writes.
9. **Removal:** remove compatibility columns and legacy table only in a later timestamp migration after live metrics show zero reads and the rollback window closes.

Every backfill is restartable, batched, idempotent, and reports counts for source, migrated, skipped, and failed rows. Take and verify a database backup before production migration.

## 17. Infrastructure changes

The baseline `postgres:15-alpine` image does not provide pgvector. The selected candidate is `pgvector/pgvector:0.8.6-pg15-bookworm@sha256:a947c45cdc5906a1bc951f20a8709e321256343ee0f251e4ae00b5e7def4e6da`; it is not production-qualified merely because it is pinned. Complete the following gate before enabling semantic indexing:

- restore a fresh production-shaped backup into the candidate image;
- run all migrations and `CREATE EXTENSION vector`;
- verify every required extension remains available;
- run fresh-database boot and backup/restore drills;
- measure lexical-only, exact-vector, and HNSW retrieval on representative tenant-filtered data;
- compare approximate results with exact-vector ground truth under highly skewed multi-tenant data and prove the selected iterative-scan or partitioning strategy meets the locked recall target without returning unauthorized rows;
- prove rollback to the backed-up prior database image/data path.

The embedding adapter calls `xeno-rt`'s OpenAI-compatible `POST /v1/embeddings` capability. The locked contract is `nomic-ai/nomic-embed-text-v1.5` revision `a15734e81021ea6c92b09050d2c7085001db8f36`, query/document task prefixes from the model card, attention-mask mean pooling, native layer normalization, 512-dimension Matryoshka truncation, and final L2 normalization. The runtime bundle contains `model_quantized.onnx` SHA-256 `b4342336debaea79de872370664b0aaeb67dea4605513d00ee236ea871a81f27` and `tokenizer.json` SHA-256 `d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66`. Runtime startup verifies both files before readiness, and platform rejects a response whose model/revision/dimensions/pooling/normalization contract differs. Lexical retrieval ships and remains available if semantic infrastructure is unhealthy.

The model bundle is a versioned deployment artifact with a manifest, checksums, source revision, license/notice, and immutable artifact location; production does not fetch a mutable model revision from Hugging Face at process start. The exact `xeno-rt` commit and bundle digest are recorded with deployment evidence. Cold-start load, a known-vector numerical parity fixture, task-prefix relevance, batch/sequence/input limits, and target-host readiness are release gates.

`/v1/embeddings` is an internal service surface. Loopback-only development may be unauthenticated, but a non-loopback bind must fail startup unless service authentication is configured. Production uses a protected network plus an exact bearer secret or stronger workload identity, rejects missing/incorrect credentials, rate-limits and bounds request bodies/concurrency, and never logs input text. `XENO_EMBEDDING_API_KEY` is meaningful only when the runtime validates it; merely sending an ignored header is not qualification.

Because the embedding crate shares ONNX Runtime dependency resolution with the existing `xrt-vision` domain, the packaged `xeno-rt` artifact must carry the required ONNX Runtime version beside the executable and must not silently load an incompatible machine-global DLL. Existing `origin/main` text, image, and vision server gates run before release so adding embeddings cannot regress other implemented XENO runtime capabilities. `xrt-video` remains a planned capability boundary on the selected release base and therefore has no runtime gate to claim or waive.

The original `xeno-rt` evidence baseline `39f1049` exists on `origin/feat/qwen38-mtp` and is 48 commits ahead of `origin/main`; its base-to-head range changes 727 files with 633,684 insertions, and 3,022 deletions. Cherry-pick qualification demonstrated that the original embedding commit depends on feature-only Qwen/MTP/video context, so that entire range is excluded rather than silently admitted as collateral Chat scope. The release implementation is the three-commit surgical port ending at `0f35bcb971a814ea996d7fc831cbc454e90bb838` on branch `codex/chat-embedding-main-port`, based exactly on `origin/main` commit `65ebc127a61baf2f5ff17e3f3450b1014fa60c06`. The first commit (`c2e015c0baa609499f626931e26e89ee607e1d84`) contains the embedding crate, immutable bundle/provisioning assets, server/CLI wiring, the required Windows ORT loading adjustment shared with `xrt-vision`, documentation, and generated dependency lock changes; the second (`14197d6362f534abbc0b5fd0b398f973898b1f3d`) repairs clean-checkout ONNX companion provisioning without changing the runtime contract; and the third adds only the checksum-locked, private-network hosted deployment path plus its dry-run/rollback gates. The complete base-to-head range remains narrow and clean-checkout parity plus current-main domain gates remain mandatory.

Run ingestion and schedule execution as explicit worker processes with readiness/health metrics. Do not host correctness-critical timers only inside the web API process. Deployment manifests must pass the embedding base URL, service credential, request timeout, and health timeout to every process that can embed or assert semantic health. Runtime status must expose the same full model/revision/dimensions/pooling/normalization contract returned by `/v1/embeddings`, and platform readiness must validate it without returning the credential.

Readiness is component-scoped: database/scheduler/lexical ingestion may remain ready while the semantic component reports `degraded`, so an embedding outage does not disable lexical project context or unrelated scheduled turns. Semantic ingestion/backfill and semantic query readiness must be false on a missing runtime, missing authentication enforcement, timeout, or contract mismatch. Release enablement requires the semantic component to be healthy; an overall HTTP 200 that omits or masks a failed semantic component is not release evidence.

The feature has a coordinated three-service rollout. Apply the additive platform schema and qualify the pgvector migration first; deploy `xeno-rt` with the exact embedding bundle and prove authenticated readiness second; deploy `xeno-api-proxy` third with `PLATFORM_DATABASE_URL`, run-key ledger health, cache-hit/no-second-charge proof, expiry-tombstone handling, and its maintenance sweep enabled; deploy platform web/workers fourth with scheduled execution still disabled; then enable semantic backfill and dispatcher claims only after all three exact commits are recorded and healthy. The platform deployment guide does not deploy the separate runtime or `api.xenostudio.ai` host, so their repository-specific release evidence is attached to the same qualification record.

## 18. Observability and operations

Emit metrics for:

- ingestion queue depth, duration, failures by extractor/error, and ready-asset count;
- retrieval latency, candidate counts, lexical/semantic degradation, selected chunks, and token allocation;
- scheduled due lag, claim count, lease expiry, attempts, success/failure, and duplicate-conflict count;
- project and asset authorization denials;
- client mutation failures by stable error code;
- use of any development fixture in production, which is a release-blocking alert.

Structured logs include request/run/asset IDs, not prompts, extracted content, share tokens, signed URLs, credentials, or raw model responses. Runbooks must cover stuck ingestion, expired leases, model outage, Redis outage, database failover, migration rollback, and vector-index rebuild.

### 18.1 Release performance budgets

The following are proposed launch SLOs, not claims about the current implementation. Phase 0 records the current baseline and locks or revises each threshold before implementation; after locking, fail the release when the qualified workload regresses by more than 20% or misses the absolute target:

- project/list/settings APIs: p95 below 300 ms excluding network edge latency;
- context retrieval: p95 below 750 ms for an initial qualification corpus of at least 100,000 chunks with both authorized and larger unauthorized tenant partitions, plus the locked approximate-recall threshold against exact-vector ground truth;
- dispatcher due lag: p95 below 10 seconds and maximum below 60 seconds while healthy;
- worker lease recovery: within one lease interval plus 10 seconds;
- ingestion: p95 below 120 seconds for a 10 MB or 200-page supported document under normal worker capacity;
- browser layout shift for the stabilized project/Library shell: cumulative layout shift below 0.1.

Record corpus size, worker count, database plan, index parameters, and machine profile with the measurements so the numbers remain reproducible.

## 19. Security and privacy

- MIME-sniff and sandbox untrusted documents; never execute embedded content.
- Enforce upload, extraction, decompression, page, chunk, and token limits.
- Require malware scanning before extraction. Scanner outage or absence keeps assets quarantined and unavailable to other principals; it never bypasses the gate.
- Sign content URLs with short lifetimes, bind them to the authorizing grant/audience, and reauthorize the asset on each issuance.
- Apply retention, erasure, and legal-hold behavior to ingestions, chunks, embeddings, messages, artifacts, shares, and run manifests.
- Account erasure first soft-disables the principal, nulls workspace-project and workspace-asset attribution, pauses tasks whose `run_as_user_id` disappeared, and performs an ordered, retention-aware purge of personally owned projects/assets before the `users` row can be physically deleted. Before personal-asset erasure, every project relation and its parent tuple is removed; retained message/run provenance manifests render a sanitized “source unavailable” label without a downloadable link. Ownership is never transferred implicitly. Workspace-owned projects/assets survive uploader deletion. Workspace deletion is likewise an ordered purge after dependent projects/conversations/tasks are archived or explicitly reassigned; restrictive foreign keys prevent accidental detach-to-personal behavior. Derived chunks/embeddings are removed without orphaning assets still authorized by another retained relation.
- Revoking project or asset access takes effect on the next request and on scheduled-run execution, not only when the schedule was created.
- Provider calls receive only selected authorized chunks. Do not send whole project files by default.
- The gateway run-key ledger stores only the canonical request hash, never the request prompt/body. Its cached response is readable only by the gateway for the same authenticated principal, is never returned by diagnostics or public shares, and participates in erasure/legal hold. The cached response is removed by the seven-day response-retention sweep; the principal/hash/run binding remains as a tombstone until the authoritative scheduled run is purged under its retention policy.
- Treat retrieved text and metadata as untrusted prompt-injection input; data blocks cannot create tool authority or override system instructions.
- Keep account activation and entitlement gates in their current order.

## 20. Testing strategy

### 20.1 Unit and contract tests

Add focused tests for:

- recurrence across `Europe/Berlin` and `America/New_York` DST boundaries, month ends, leap years, misfires, and overlaps;
- the locked RFC library's distinct spring-gap cases (initial/one-shot `DTSTART` uses the pre-gap offset, while an `RRULE`-generated nonexistent time is skipped and not counted) and first fall-overlap occurrence;
- deterministic chunking and locators for every launch format;
- instruction precedence and token budgeting;
- lexical ranking, hybrid fusion, overlap deduplication, and lexical-only degradation;
- typed pending conversations being rejected by persisted APIs;
- expired, mismatched, reused, and forged interactive context IDs being rejected before assistant-message persistence;
- fixture adapters excluded from production-authenticated imports;
- stable API error codes and zero-row mutation behavior;
- malicious retrieved instructions remain data and cannot trigger tools or override higher-priority instructions;
- signed drag/export payloads contain a revocable expiring URL, not an internal storage path.
- public-share serialization strips structured and plaintext-embedded private asset references while private authenticated conversation reads retain authorized citations;
- migration capability requirements defer without false application, apply after the capability appears, and reject unknown requirements;
- the `xeno-rt` embedding response matches an independent tokenizer/ONNX numerical fixture, enforces query/document prefixes and bundle hashes, rejects contract drift, and requires authentication on a non-loopback bind;
- gateway request canonicalization, principal/hash conflicts, parallel same-key calls, successful cache hits with zero additional charge, retryable pre-dispatch failure, ambiguous post-dispatch failure, acknowledged manual retry, seven-day response expiry, and non-dispatching expired tombstones.
- gateway rejection of invented or unauthorized real run IDs, authoritative `run_as_user_id` mismatch, and user deletion that would otherwise cascade-delete a retained run-key tombstone;
- component readiness proving lexical scheduling remains available during an embedding outage while semantic readiness/backfill fail closed, plus negative probes for missing credentials and runtime/database contract drift;

### 20.2 Real PostgreSQL integration tests

Run core tenancy, ingestion, lexical retrieval, scheduling, and migration tests against the current plain PostgreSQL 15 image so Phases 1–3 cannot accidentally depend on pgvector. Run the semantic-only matrix separately against the exact candidate PostgreSQL 15/pgvector image and digest from section 17:

- schema migration from baseline and from current production shape;
- concurrent dispatchers create one run per occurrence;
- worker crash after user-message insertion resumes without duplicate messages;
- expired lease recovery;
- owner/editor/viewer/agent role matrix;
- guessed cross-tenant project and asset UUID denial;
- project deletion, asset unlinking, account/workspace deletion, and retention;
- creator deletion leaves workspace projects and their conversations, messages, artifacts, and conversation-scoped skills intact while personal retained-data policy still purges personal resources in order; project deletion cannot detach conversations or tasks into personal/unscoped state;
- one asset linked to multiple projects retains access only through the caller's current authorized parents, and revocation invalidates new link issuance;
- ingestion deduplication and retry;
- authenticated create failures produce no durable or fabricated local object.
- interactive context handoff is single-use and bound to the authenticated user, request, project, and conversation;
- gateway ledger transitions and credit/usage effects are tested with a real database from `xeno-api-proxy`, including concurrent calls and crash-boundary injection.
- semantic retrieval compares HNSW results with exact-vector ground truth under skewed tenants, deliberately places a larger unauthorized project in the same hash partition as the authorized project, proves authorized-candidate recall at the locked threshold, and verifies the SQL plan carries the project/parent predicates before results leave PostgreSQL;
- `xeno-api-proxy` runtime and maintenance database roles are tested separately so the request path cannot delete ledger rows or read task prompts/context, while the maintenance path cannot dispatch providers or charge credits.

Tests run in transactions or isolated databases and leave no account data behind.

### 20.3 End-to-end browser and worker tests

Using an authenticated test account:

1. create a project and unique project instruction;
2. upload a document containing a unique fact and wait for `ready`;
3. ask a question and assert the answer uses the instruction and cites the Library asset;
4. hard reload and verify project, asset, conversation, citations, and preview route persist;
5. create a schedule one to two minutes ahead and observe the real worker create exactly one user/assistant pair;
6. hard reload and verify run history and next occurrence;
7. pause the schedule and prove no later run is claimed;
8. open the same project as viewer and editor identities and verify capabilities;
9. force API failures for conversation, share, artifact, preferences, connector, plugin, and memory writes and assert no fake success;
10. verify layout with both Overview navigation and right Library history expanded/collapsed.
11. open the same uploaded/generated image from Library and from two conversations, verify identical preview/history behavior, then drag it to a cross-origin test drop target and prove the signed URL works until expiry/revocation.

### 20.4 Existing gates

Retain and extend:

- `npm run test:chat-migrations`;
- `npm run test:chat-writes`;
- `npm run test:chat-conversation-id`;
- `npm run test:chat-library`;
- `npm run test:chat-settings-persistence`;
- `npm run test:chat-workspace-equilibrium`;
- scoped type validation for every changed/new Chat file, the repository `npm run typecheck`, and production build.

Source-substring tests must be supplemented with behavioral tests; they cannot be the only evidence for any acceptance criterion. Rewrite the brittle `chat-conversation-id` assertion that hard-codes `chat_projects.user_id = $2` as a behavioral authorization test for personal and workspace projects.

The 2026-08-29 baseline `npm run typecheck` is already red with unrelated errors across the repository. Phase 0 records the exact diagnostic set (command, commit, count, and output hash). This feature may introduce zero new diagnostics and every changed/new Chat file must be clean. Full repository typecheck green remains a Phase 6 release prerequisite owned as explicit baseline-remediation work; the existing failures must not be hidden, waived, or misattributed to this feature.

## 21. Acceptance criteria

The work is complete only when all statements are true:

1. A unique project instruction changes both interactive and scheduled responses, with a manifest proving the exact revision used.
2. A fact present only in an authorized project document is retrieved and cited; a user without access cannot retrieve or download it even with known IDs, and a much larger unauthorized project forced into the same semantic hash partition cannot suppress the authorized top-12 below the locked recall threshold.
3. DOCX, textual PDF, image-only PDF, Markdown, code, CSV, and corrupt/unsupported files show correct durable ingestion outcomes.
4. Project attachment links a `user_files` asset and does not create another byte copy or Chat-owned extracted-text authority.
5. Every new upload and generated binary has one canonical, immutable `user_files` asset with digest/provenance; resolvable existing generated outputs are backfilled and unresolved exceptions are reported.
6. Authenticated conversation-create failure never creates a `convo-*` record, Recents entry, downstream UUID request, or saved indicator.
7. A daily 09:00 `Europe/Berlin` schedule stays at 09:00 across both DST transitions; spring-gap and fall-overlap policies match section 13.1 exactly.
8. Two dispatchers and two workers cannot create two logical runs, duplicate message roles, or duplicate message indexes for one occurrence.
9. Killing a worker after each execution boundary recovers or terminates visibly without losing the run; a known gateway result is reused for the same run key, while an unreconcilable ambiguous provider outcome becomes `reconciliation_required` with no automatic duplicate call.
10. Run history exposes scheduled time, state, attempts, model, result references, and sanitized error after hard reload.
11. Workspace owner/admin/editor/reviewer/viewer and explicit agent grants match the role matrix on every project child route.
12. Deleting a workspace-project creator does not delete the project or its retained conversations, messages, artifacts, or conversation-scoped skills; deleting/archiving a project cannot detach conversations, assets, or tasks into personal/unscoped access.
13. Disabling access before a scheduled occurrence prevents context disclosure and records an authorization failure.
14. Private Library bytes are absent from public conversation shares unless a separate explicit asset capability is issued.
15. An uploaded or generated image opens through the same Library preview from multiple chats and drags via an expiring, revocable cross-origin URL.
16. Share, artifact, customization, memory, connector, and plugin writes never display success when their server write fails; an unqualified catalog renders empty rather than mock connected data.
17. Malicious document instructions remain untrusted data and cannot add tool authority, cause an unauthorized tool side effect, or override the instruction precedence, including when a mock model emits a matching tool call.
18. Production-authenticated code cannot import the development fixture adapter.
19. Changed/new Chat files add zero type diagnostics; the full repository typecheck baseline is repaired before release. Focused tests, the plain-PostgreSQL core matrix, the separately pinned pgvector semantic matrix, production builds, deployed platform/gateway/runtime component readiness, embedding numerical parity and authenticated non-loopback access, existing `xeno-rt` domain regression gates, worker health, explicit lexical-only behavior during semantic outage, authenticated browser hard reload, and scheduled execution proof all pass.
20. The exact deployed `xeno-platform`, `xeno-api-proxy`, and `xeno-rt` commits are present on their remotes, built from clean checkouts, and identifiable in deployment evidence; the immutable embedding bundle digest, manifest, and license/notice are recorded with them. The deployed `xeno-rt` commit descends from an explicitly recorded release base, and its complete base-to-head range—not only the embedding commit—has been reviewed and qualified.
21. No existing activation, suspension, entitlement, tenancy, noindex, registration, or Library signed-link control is weakened.
22. Interactive citation persistence rejects forged/reused context IDs, and a hard reload restores only the server-owned safe source projection linked to the assistant message.
23. A repeated scheduled gateway request with the same principal/key/hash returns the cached status/body during response retention, performs no downstream provider call, and records no second credit/usage effect; mismatches and ambiguous outcomes fail closed as section 8.9 specifies. Invented keys, known run IDs presented by the wrong principal, and runs whose current `run_as_user_id` does not match are rejected before provider/credit dispatch. After seven-day response expiry or deletion of the user row while the run is retained, the bound tombstone still prevents automatic provider/credit dispatch, and production grants prove the ordinary gateway principal cannot delete that idempotency record.

## 22. Delivery plan

### Phase 0 — lock contracts and evidence fixtures

- add behavioral regression tests for current defects;
- verify the already selected embedding/model/index and direct recurrence-library contracts, then lock the scanner implementation, connector catalog contract, and Marketplace plugin reference contract; validate section 8.9 against platform and gateway and the embedding contract against platform and runtime before implementation proceeds;
- record the intended `xeno-rt` release base and disposition of the 48-commit `origin/main..39f1049` feature range; compatibility testing on that range is not release-scope approval;
- create production-shaped migration fixtures;
- capture current row counts and backup/restore evidence;
- record the exact red repository typecheck baseline and create separately owned remediation work that must finish before Phase 6.

**Exit:** failing tests demonstrate each gap without relying on source substrings.

### Phase 1 — fail-closed server authority

- remove authenticated local-success fallbacks;
- wire existing settings, persona, artifact, share, skill, and memory authorities; add only the focused connector/plugin persistence that does not already exist;
- introduce typed pending conversations and stable error states.

**Exit:** forced write failures produce no fabricated state.

### Phase 2 — tenancy and normalized project assets

- migrate project authorization to transactional ReBAC inheritance;
- create `chat_project_assets`, extend canonical `user_files`, and backfill existing project files plus resolvable generated outputs;
- enforce capability-based UI and routes.

**Exit:** role matrix and cross-tenant integration suite pass.

### Phase 3 — Library ingestion and lexical context

- build ingestion state machine, extractors, chunks, locators, GIN search, and provenance;
- implement shared context assembler;
- wire interactive and scheduled entry points.

**Exit:** unique-fact document proof passes with citations in both paths.

### Phase 4 — semantic retrieval

- finish and qualify the `xeno-rt` embedding crate/server surface, authenticated deployment, immutable model bundle, numerical parity, and existing-domain non-regression gates;
- qualify the pinned pgvector image plus the 64-way project-hash/strict-iterative-scan strategy, including same-partition adversarial tenant collisions;
- backfill embeddings and add model-specific HNSW index;
- enable hybrid fusion with lexical fallback.

**Exit:** retrieval relevance, tenant filtering, latency, restore, and degradation gates pass.

### Phase 5 — durable scheduling

- migrate recurrence representation;
- add logical runs, claims, leases, step idempotency, history UI, and operations metrics;
- implement and qualify `xeno-api-proxy` run-key caching, downstream-dispatch state, credit/usage idempotency, provider reconciliation where supported, seven-day cached-response expiry into retained tombstones, separated runtime/maintenance database privileges, and fail-closed `reconciliation_required` handling before enabling scheduled inference;
- move scheduling to explicit workers.

**Exit:** DST, concurrency, crash-injection, and live one-minute execution proofs pass.

### Phase 6 — release qualification

- push all three repository branches, review/merge the changes, publish the immutable embedding bundle, and build each artifact from its remote commit;
- follow platform `release-guide/` and `scripts/deploy-platform.mjs` gates plus the separate `xeno-rt` runtime/model and `xeno-api-proxy`/`api.xenostudio.ai` deployment runbooks;
- follow the schema → embedding runtime → gateway → disabled platform workers → enablement order in section 17, and verify database migration, all three readiness surfaces, worker readiness, all three exact commits and the bundle digest, browser flow, cache/credit behavior, and coordinated rollback;
- wait through at least one normal scheduled execution and one ingestion cycle.

**Exit:** every acceptance criterion has an attached artifact. Cleanup of verification records occurs only after explicit user authorization.

## 23. Rollback strategy

- Keep schema changes additive through the observation window.
- Feature-flag semantic retrieval, scheduled execution, and new server-authoritative services independently; flags may disable new execution but may not re-enable fake-success fallbacks.
- Disable dispatcher claims and semantic backfill before rolling back any service. Roll back platform containers, `xeno-api-proxy`, and `xeno-rt` independently to their previous immutable revisions while retaining additive tables; never run a new scheduler worker against a gateway revision that lacks the run-key contract, and never enable semantic indexing against a runtime whose response contract differs from the active database contract.
- Pause dispatcher claims before database rollback; allow leased runs to finish or expire.
- Restore the pre-migration database only for destructive migration failure, using the qualified restore procedure.
- Retain legacy project-file and cadence columns until live zero-read evidence and rollback expiry.
- Record every rollback with deployed commit, schema version, affected runs, and recovery action.

## 24. Risks and mitigations

| Risk | Mitigation |
|---|---|
| cross-tenant retrieval leaks content or loses recall under filtered HNSW | authorize project and every asset at query time; exact project/parent predicates inside lexical/vector candidate queries; qualify strict iterative scans and hash partition pruning against exact ground truth with deliberately colliding project partitions; adversarial ID tests |
| creator or project deletion changes resource scope | nullable attribution, exclusive owner/workspace constraint, restrictive project foreign keys, soft archive, and ordered retention purge |
| a personal asset leaks through a workspace/public share | transactional asset-parent tuple, grant-bound signed capability, request-time reauthorization, and no implicit bytes in public conversation shares |
| vector infrastructure delays project usefulness | lexical retrieval is complete and mandatory first, so Phase 3 exact-text knowledge can be qualified independently; semantic retrieval remains a Phase 4 and final-release acceptance requirement |
| duplicate scheduled messages after crash | unique logical run, per-role message uniqueness, resumable steps, leases, and crash-injection tests |
| duplicate provider spend after ambiguous crash or cache expiry | gateway run-key cache plus provider reconciliation; cache hits do not repeat credit/usage accounting; expiry clears response data but retains the bound tombstone; unreconcilable ambiguity stops automatic retry and requires a warned manual action |
| platform, runtime, and gateway deploy out of order | record all three commits plus the bundle digest and enforce schema → runtime proof → gateway proof → disabled worker deploy → enablement; rollback disables claims first |
| embedding endpoint is exposed or silently ignores the configured credential | non-loopback startup requires service authentication, negative auth probes are release gates, and the platform sends the secret only to a runtime that validates it |
| shared ONNX Runtime packaging regresses vision or loads a machine-global DLL | ship the locked runtime DLL beside `xeno-rt`, verify loaded version/path, and run existing `origin/main` text/image/vision gates before release; do not claim a video gate on a base where `xrt-video` is still planned |
| forged or replayed interactive citation manifest | server-issued short-lived single-use context ID bound to user/request/project/conversation; private immutable message manifest and safe projection only |
| Redis outage loses work | PostgreSQL run ledger is authority; Redis/Bull only signals workers; database polling recovers pending runs |
| DST changes schedule wall-clock time | IANA timezone + RFC recurrence; preview next occurrences; boundary tests |
| large/malicious or prompt-injecting document harms workers/model behavior | mandatory scanning, isolated networkless extraction, resource limits, data-only context delimiters, no content-derived tool authority, and adversarial tests |
| migration silently drops unresolved project files | exception report and dual-read compatibility; no destructive removal until zero exceptions |
| model change invalidates embeddings | content/model/version-keyed ingestions and model-specific indexes; reindex before cutover |
| UI appears saved during outage | explicit pending/failed states and production ban on fixture adapters |
| local-only commits cannot reproduce deployment | remote clean-checkout build and exact deployed-commit proof are release criteria |

## 25. Decisions, assumptions, and open dependencies

### Locked decisions

- `user_files` and Library services own assets and derived knowledge.
- PostgreSQL owns durable scheduler state and logical-run idempotency.
- existing ReBAC tuples own project collaboration.
- managed Library bytes are immutable; content replacement creates a new canonical asset.
- public conversation sharing and private asset sharing are separate grants.
- interactive and scheduled turns share one context assembler.
- lexical retrieval remains permanently alongside semantic retrieval.
- authenticated production never fabricates persistence success.
- `rrule` 2.8.1 is the direct recurrence dependency.
- `nomic-ai/nomic-embed-text-v1.5` revision `a15734e81021ea6c92b09050d2c7085001db8f36`, its recorded model/tokenizer checksums, 512 output dimensions, and the normalization/pooling contract in section 17 are the first embedding contract.
- `pgvector/pgvector:0.8.6-pg15-bookworm@sha256:a947c45cdc5906a1bc951f20a8709e321256343ee0f251e4ae00b5e7def4e6da`, strict iterative HNSW scans, and 64-way project hash partitioning are the first semantic-store contract; recall qualification includes colliding project hashes.
- seven days is cached gateway response retention, not deletion of the run-key binding; expired bindings remain tombstones until authoritative run retention/erasure.

### Assumptions verified in the repository

- PostgreSQL 15 is the current database baseline.
- `relationship_tuples` and parent inheritance already exist.
- `mammoth`, Redis, Bull, and Library asset helpers are available, though the custom `backgroundJobs.js` queue is not durable enough by itself.
- existing chat migrations are timestamp-named under `src/server/database/migrations/`.
- `xeno-api-proxy/server.js` owns `POST /v1/chat/completions` and already has an optional canonical platform PostgreSQL connection through `PLATFORM_DATABASE_URL`; the platform release guide does not deploy that separate service.

### Dependencies that must be locked in Phase 0

- PDF extraction/OCR adapter at the XENO processing/runtime boundary;
- mandatory malware scanner/runtime boundary and quarantine operations contract;
- initial connector definitions, OAuth redirect URIs/scopes, and Marketplace listing/version/entitlement identifiers; zero qualified entries is an acceptable honest launch state;
- retention period for derived chunks, embeddings, message/run manifests, revoked shares, and expired gateway idempotency tombstones. Gateway cached response retention is locked to seven days by section 8.9.

These dependencies change implementation parameters but not the target architecture or acceptance criteria. None authorizes a temporary fake-success or cross-tenant shortcut.

### Rejected alternatives

| Alternative | Rejection reason |
|---|---|
| copy files/text into Chat project rows | creates two asset authorities, breaks cross-product reuse, and makes erasure/versioning drift |
| inject every whole project file into every prompt | leaks irrelevant content, defeats token budgets, raises cost, and cannot provide precise provenance |
| semantic-only retrieval | regresses exact identifiers, quoted text, filenames, and error strings |
| browser-side project prompt assembly | authorization and scheduled execution would diverge from interactive Chat |
| elapsed `+24h` scheduling | changes wall-clock time across DST and does not express real recurrence semantics |
| Redis list/Bull job as the only run record | acknowledgement loss or queue loss would erase user-visible schedule history and correctness evidence |
| keep local fallback objects during outages | makes failed writes indistinguishable from persisted account state and recreates invalid-ID cascades |
| authorize only with `user_id` predicates | cannot represent workspace inheritance or direct scoped grants and encourages missed-route checks |
| cascade project/workspace deletion into nullable children | can silently detach conversations or tasks into personal/unscoped access; use archive, restrictive foreign keys, and ordered purge |
| embed private asset URLs in public shares | conflates conversation visibility with byte access and prevents immediate authorization revocation |

## 26. Authoritative references

- [PostgreSQL 15 `SELECT` locking clauses](https://www.postgresql.org/docs/15/sql-select.html) — `SKIP LOCKED` is suitable for queue-like contention but provides an inconsistent view, so the unique run row remains the correctness boundary.
- [PostgreSQL 15 Full Text Search](https://www.postgresql.org/docs/15/textsearch.html) — canonical `tsvector`, query, ranking, and index facilities used for lexical retrieval.
- [PostgreSQL 15 `CREATE INDEX`](https://www.postgresql.org/docs/15/sql-createindex.html) — `NULLS NOT DISTINCT` is required for ingestion deduplication when the embedding model is null.
- [RFC 5545: iCalendar](https://www.rfc-editor.org/rfc/rfc5545.html) — recurrence, `DTSTART`, local time, timezone references, first fall-overlap occurrence, pre-gap interpretation of an initial DATE-TIME, and the separate rule that recurrence-generated invalid/nonexistent instances are ignored.
- [pgvector](https://github.com/pgvector/pgvector) — vector storage, cosine distance, HNSW/expression/partial indexes, hybrid RRF, and the filtered-approximate-search/iterative-scan behavior that section 8.4 must qualify.
- [PostgreSQL 15 table partitioning](https://www.postgresql.org/docs/15/ddl-partitioning.html) — hash partitioning, virtual partitioned indexes, and plan/execution-time pruning behavior used by the derived project-vector index.
- [Nomic Embed Text v1.5 model card](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) — query/document prefixes and Matryoshka dimension behavior for the locked embedding contract.
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) — deny by default, validate every request, and prefer relationship/attribute-aware access control.
