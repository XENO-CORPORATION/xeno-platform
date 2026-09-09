# Public health failure redaction

Status: implemented and locally tested OPS-1 security repair, 2026-09-08. Not deployed qualification.

## Contract and evidence

Preserve health alert states while preventing public responses from exposing filesystem paths, arbitrary exception strings or database/secret material. Existing endpoint comments already require coarse public diagnostics.

KNOWN: `src/server/routes/healthRoutes.js` returns `dir` when no dump is found and serializes `err.code || err` for backup and secretbox failures. An arbitrary thrown Error or string can therefore become public response content. Other dependency checks already return fixed diagnostics.

UNKNOWN: current deployed watcher behavior and health output. Resolve separately through an authorized target qualification; this change makes no deployed claim.

## Scope and invariants

- Preserve routes, HTTP status aggregation, backup freshness threshold, cache behavior, and secretbox missing/mismatch/no-data semantics.
- INV-1: Missing dump responses never contain configured directory values. Test the real HTTP route with a sentinel directory and empty listing.
- INV-2: Backup and secretbox failures return only fixed reason codes (`backup_unavailable`, `secretbox_unavailable`), regardless of thrown Error, string, or code. HTTP fixture tests inject sensitive sentinel values in each shape.
- INV-3: Operational alarms do not change overall health HTTP status; database/Redis failure still degrades it. Exercise healthy dependencies and failures separately.
- INV-4: Tests execute the production router over loopback using synthetic dependency boundaries; no external requests, production DB, real files, provider credentials, or notifications.

No new monitoring service, key changes, production restart, or dependency installation. Lenses: security, compatibility, observability. No money/schema/business-policy changes.

## Plan and verification

Independent falsification, then real-router regression fixtures, minimal response redaction, focused tests, full reachable regression and typecheck. Wire regression into the existing default test chain. Record exact local results and outstanding OPS-1 target checks. Rollback only these owned source hunks; preserve all pre-existing WIP.

## Falsification and reconciliation

Accepted both MATERIAL review findings: HTTP aggregation checks now include R2 404, 5xx and network failure; repeated requests through the same router must prove one secretbox query/decryption while DB/Redis checks run on each request. No requirement was relaxed.

Before the production repair, all 15 original real-router checks failed on the exposed directory or raw failure reasons. All 17 final real-router checks pass, including the two review requirements. The default regression chain includes them. See `../release-evidence/2026-09-08-platform-local-continuation.md` for broader local results; no target monitoring qualification is implied.
