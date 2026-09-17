# Security Audit Correction & Provenance Record

**Document Date:** 2026-09-16  
**Auditor / Context:** Platform Closure Engineering / Handoff Review  
**Subject Row:** `security_events.id = '1d12a455-6c8b-4dc7-b352-f0f61c18d430'`

---

## 1. Executive Summary

A prior assistant session created a backfilled audit entry in `security_events` attributing an operator credential modification to an out-of-band direct database write. A rigorous cross-examination against retained production access logs revealed a fundamental timestamp and causality conflict. 

This document records the provenance, the conflicting evidence, the epistemological limits of database column inspection, and the sanctioned corrective posture—preserving historical audit immutability without silently modifying existing records.

---

## 2. Conflicting Evidence Inventory

| Evidence Source | Observed Fact | Implication |
|---|---|---|
| **`security_events` (row `1d12a455…`)** | Inserted with event `password_reset_admin`, timestamp `2026-09-15 18:28:02.369902`, method `out_of_band_direct_db_write`, `metadata.backfilled = true`. | Assumes an out-of-band operator SQL execution directly on PostgreSQL. |
| **Captured Production Gateway Logs** | Production HTTP log records `PUT /api/auth/password` returning HTTP `200` at `2026-09-15 18:28:02.379`. | Demonstrates an in-band, authenticated API password change occurred within 10 milliseconds of the claimed direct DB write. |
| **`users.updated_at` Column** | Stored timestamp reflects the last row update timestamp. | `updated_at` merely stores the timestamp of the last write; it cannot distinguish an application ORM/pool write from a direct `psql` statement, nor can it provide a sequence of multiple writes within the same millisecond. |
| **Session Table State** | Zero active sessions observed post-facto. | Zero remaining sessions at the time of inspection is consistent with both normal session expiration/manual revocation and atomic post-reset invalidation; it cannot prove historical revocation counts at `18:28:02`. |

---

## 3. Discrepancy Analysis

The 10-millisecond window between the recorded `PUT /api/auth/password` response (`18:28:02.379`) and the backfilled timestamp (`18:28:02.369902`) establishes that the previous assistant inferred the `out_of_band_direct_db_write` method without sufficient causal grounding. 

Specifically:
1. **Timestamp Conflation:** The timestamp used for the purported out-of-band direct DB reset was almost certainly derived from the very same password update that generated the `PUT /api/auth/password` log entry.
2. **False Attribution:** Labeling the event `method: "out_of_band_direct_db_write"` turned an unverified assumption into a recorded audit fact.
3. **Epistemological Limit:** It is impossible from Postgres row state alone (`users.updated_at`) to confirm whether the database write was executed via backend API connection pool or via an interactive `psql` terminal on the VPS.

---

## 4. Audit Correction & Policy Posture

In accordance with XENO Platform security doctrine:

1. **No Silent History Rewriting:** Row `1d12a455-6c8b-4dc7-b352-f0f61c18d430` will NOT be deleted or mutated in-place. Tamper-evident audit logs must preserve what was written.
2. **Recorded Uncertainty:** The provenance of `1d12a455-6c8b-4dc7-b352-f0f61c18d430` is formally recorded here as **uncertain / disputed attribution**. The primary operational evidence supports an authenticated `PUT /api/auth/password` API call at `18:28:02.379`.
3. **No Operator Impact:** This historical correction is purely documentary and does NOT warrant or permit resetting the operator password, changing active credentials, or extracting password hashes.
4. **Permanent Precedent:** Transactional audit logging has now been engineered directly into the password routes (`PUT /password`, `POST /admin-reset-password`, `POST /reset-password`) using `recordSecurityEventTransactional(client, ...)` before commit. Out-of-band backfills will not recur because database transactions and audit logging are now atomic.
