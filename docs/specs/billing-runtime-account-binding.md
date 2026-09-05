# Runtime billing account binding

Local implementation only; no deployment, account adoption, payment or migration approval.

Every checkout, portal and checkout-status call authenticates the configured Stripe
account freshly, with bounded reads. Explicit account/mode pins and matching secret
and publishable key modes are mandatory. New live sales additionally require the
capability policy established by stripe-account-cutover.md; reconciliation does not.
Checkout prices must explicitly match the pinned mode.

Signed webhook envelopes must have the expected mode and no connected-account
context. Retrieve their canonical event through the pinned account client, validate
its identity/type/mode/context, and process that copy before touching the database.
Provider/configuration errors are static and fail closed; webhook failures remain
retryable. This does not prove publishable-key ownership or replace signature checks.

A transaction-level advisory lock serializes initial database binding. The
transaction sets local lock_timeout and statement_timeout to 10 seconds before
requesting the lock; rollback/commit restores pooled-session settings. A singleton
row permanently pins account and mode. No automatic update/adoption exists. An
unbound database may initialize only with no billing_customers, billing_events,
billing_charges, provider-backed xeno_account_plans, workspace metadata.billing
subscription IDs, or consumed checkout sessions. Existing rows require a separately
reviewed inventory-backed adoption/migration. Missing optional tables are inspected
with to_regclass; malformed present schemas fail closed. No history is rewritten.

Verification uses synthetic provider clients and database fixtures: invalid pins,
wrong account/mode, capability restrictions, canonical webhook lookup, unchanged
database on refusal, legacy state, concurrent initial binding, and both producers.
Production rollout must stop old unguarded writers; it must qualify legacy mappings
and in-flight events before adopting a binding. This guard is not that migration.

Local verification: focused account/checkout/payment/preflight/receiver tests passed.
`node scripts/qualify-platform-local.mjs --billing-only` passed 58 real PostgreSQL
money-in/signed-HTTP checks, including each legacy mapping class, concurrent empty
binding and changed-account/mode refusal. Backup/restore and owned-resource cleanup
passed; receipt: C:/Users/bnkr/AppData/Local/Temp/xeno-launch-evidence-WY3MJZ/report.json.
Provider calls/signatures in those tests use explicit synthetic account/event
fixtures; this is not new hosted Stripe proof. Next provider qualification requires
the actual sandbox publishable key and Event retrieval permission. The delivered-loop
harness now validates pins/key mode before actions and binds its fresh empty fixture
database before deliberately inserting test-clock customer mappings.

Timeout follow-up: focused account/checkout/payment checks passed 31/31. Fresh
`--billing-only` passed 60/60, including real PostgreSQL contended-lock and slow-query
timeouts, rollback, one-slot pool release/reuse and unchanged session settings and
binding. Backup/restore and cleanup passed. Latest receipt:
C:/Users/bnkr/AppData/Local/Temp/xeno-launch-evidence-ZcglF3/report.json.
