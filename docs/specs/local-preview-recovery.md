# Local preview recovery

Tier 2, 2026-09-04. Restore the local preview against the latest required schema without overwriting the existing local database. Production and external provider mutations are out of scope.

## Evidence

- KNOWN: `xwc-gate-pg` runs plain PostgreSQL, not pgvector (`docker inspect`); `xeno_ui_local_qual` contains two users, including the requested BFF test account, and no vector extension (`pg_extension`).
- KNOWN: the latest API refused startup with deferred `20260829121000`, which requires pgvector >=0.8.6. Evidence: `Temp/xeno-local-api-restart.stderr.log` and that migration's REQUIRES header.
- KNOWN: `start-xeno-local-preview.bat` starts only Vite; frontend is 5183, API is absent at 8090. Existing Redis is 6379.
- KNOWN: the canonical pinned pgvector image and isolated clone/restore comparison implementation exist in `scripts/remote-chat-database-cutover.sh` and `scripts/qualify-platform-local.mjs`.
- UNKNOWN: post-migration behavior with this local account; resolve through full startup, ready endpoint through Vite and authenticated browser smoke. No real provider quality claim.

## Contract and checks

1. Read/copy only `xwc-gate-pg` / `xeno_ui_local_qual`; never drop, reset or replace it. Verify exact container name/identity and database. API has stopped; require no non-inspection source database connections during snapshot, dump and fingerprint verification. Abort if a writer appears or before/after fingerprints differ.
2. Restore into a uniquely named, owned, loopback-only pgvector container. Source is PostgreSQL 17.11, so use the independently verified amd64 pgvector 0.8.6 / PostgreSQL 17 pin `sha256:dca0d688bbb31d3f851502ffcb9c7791387b4fcc544ae434dab41761e5ece317`, not the qualifier's PostgreSQL 15 image. Match source PostgreSQL major version before proceeding. Refuse port collisions and remote Docker contexts. Retain source and dump as rollback artifacts, never delete automatically.
3. Compare complete public table row fingerprints, schema/security definitions and sequences before starting migrations, reusing the existing qualifier comparator. Check preserved account and ledger state. Failed restore/comparison never becomes an API target.
4. Run the full shared required startup pipeline on the copy; require all migrations applied and replay idempotent. Only then start the API on 8090 and require direct and frontend-proxied `/api/ready` success. No auth bypass, balance grants, password reset or real paid request.
5. Keep runtime credentials out of tool output, source and artifacts. Reuse local database authentication privately; API signing was previously ephemeral, so a new local signing secret requires normal login. No provider credentials are loaded by recovery. New processes use explicit allowlisted local configuration.
6. Keep new container/data on success for user review. On failure, stop only processes/containers created by this operation; retain evidence. Rollback is restoring the previous source target with compatible source code, not weakening the schema gate. Any new user activity on the copy requires reconciliation before switching back.

## Sequence and reporting

Independent falsification, snapshot/copy verification, canonical migrations/replay, API startup, proxy health, browser smoke; record exact target IDs and results. Correct the frontend-only launcher only after identifying the verified restart command. Lenses: local data safety, availability and credentials. No production release, new account protocol or UI design changes in this recovery.

## Falsification amendments

- Preview bootstrap excludes dotenv and inherited provider credentials. Enforce development and loopback bindings; never bypass auth or migrations.
- Use a dedicated owned Redis instance, not the existing queue. Disable all embedded background processing, webhook/email sweeps, scheduled tasks and physical-file cleanup in preview. Move conversion consumer startup behind the same migration gate for normal runtime too.
- Compare ownership, ACLs/default privileges and exact sequence state in addition to the shared data/schema comparator. Preserve owners and privileges in this copy (no `--no-owner` / `--no-privileges`). This is a local UI preview, not worker or external-provider qualification.
