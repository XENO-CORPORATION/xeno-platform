# Provider qualification continuation — 2026-09-04

Historical preflight snapshot. Later dedicated-sandbox hosted subscription,
renewal, credit-pack/refund, public HTTPS delivery and provider recovery results
are recorded in [the lifecycle evidence](2026-09-04-stripe-hosted-lifecycle.md).
The no-transaction statements below describe this earlier preflight only.

## Result and scope

The payment service-loop harness is hardened locally; no provider transaction,
email, deployment, secret/configuration change or running-preview restart occurred.
Hosted payment/auth and production launch are still unqualified.

## Live read-only evidence

At 11:53 UTC, using existing verified SSH access to `xeno-platform-001` and
`xenostudio-backend`, without copying secrets or writing server files:

- `/api/billing/config`: HTTP 200, billing enabled, public key TEST mode; eight
  offered EUR items available. Localhost returns enabled=false, as expected.
- Server environment presence: Stripe secret/publishable/webhook, Resend and
  Google client ID/secret are SET. Stripe secret mode is TEST. Presence is not
  email/OAuth or webhook-signature verification.
- Read all ten configured prices from Stripe, using current local canonical
  `priceIssues` in a stdin-only read-only probe against the installed catalog:
  all test-mode, all amount/currency/recurrence/shape checks passed. Legacy flat
  team price remains unconfigured; this is expected. No catalog value was changed.
- Current canonical webhook verifier, using the **deployed** handler source:
  one matching enabled test endpoint at `https://xenostudio.ai/api/billing/webhook`,
  coverage of all 11 handled events. This does not prove delivery or secret match.
- Automatic tax enabled; provider tax settings active, no missing fields; zero
  active test tax registrations. This is not a determination of legal tax duties,
  nor proof of correct tax calculation or a reason to disable tax.
- Local `/api/ready`: HTTP 200, ready. Signed-in preview was not restarted.

The deployed account's test events currently target the deployed database. Its
credentials must not simply be borrowed by a local fixture run: numeric user IDs
or metadata could collide across databases. Prepare an isolated Stripe sandbox
and endpoint bound to the disposable DB. The repaired harness refuses shared
enabled webhook destinations before fixture writes; no production-facing endpoint
was modified. Hidden CLI forwarders/concurrent configuration changes must also be
excluded before execution.

## Local repair

`scripts/paid-loop-proof.mjs` now defaults to an offline UNEXECUTED plan, rejects
unknown/duplicate arguments and non-test/shared/remote database targets, validates
the actual DB name/comment, and resolves dependencies beside the backend package.
The service-loop implementation passes and verifies the exact recorded consent,
requires strict entitlement results, tracks swallowed SQL failures, suppresses
dependency exception output, and makes unresolved cleanup fail the receipt.

Open sessions and subscriptions are discovered across all pages, ownership checked,
settled and terminal states verified. Customer deletion is verified. SQL evidence
and historical Stripe records remain for reconciliation; no claim of erasing all
provider records. Real API fault behavior has not yet been exercised.

25 injected-provider/DB behavioral tests pass; 57 tests with the existing billing
preflight suite pass. CLI plan/refusal are tested in real child processes. These
are harness controls, not actual Stripe transaction evidence.

Full default regression before the final shared-webhook/known-object additions:
1,267 passed, 22 skipped, zero failed (1,289 tests). TypeScript passed. See the
final regression addendum below for the final source run.

## Remaining external and release boundaries

PAY-1: isolated hosted checkout, signed delivered events, delayed payment,
renewal/cancellation/refund, receipts, relogin entitlement and browser evidence.
PAY-2: live-mode configuration and tax/business validation before accepting money.
AUTH-1: approved real test inbox, activation/resend/expiry/recovery and Google
browser journey. Server credentials exist; do not call this a missing-key blocker.
DATA/OPS/COM/REL: production-shaped restore/rollback, target monitoring/failure
drills, commercial confirmation, reviewed release artifact and approved deployment.
HIER/UI/PERF remain open as detailed in the launch register; this payment repair
does not claim to close those unrelated requirements.

Before external mutations: present the exact isolated targets, synthetic account,
test transactions and cleanup/retained evidence, then obtain action-time approval.
Do not use production DB fixtures or disable existing webhooks to obtain a pass.

## Final regression addendum

Final source `npm test` exits 0: **1,291 tests, 1,269 passed, 22 skipped,
zero failed/cancelled/TODO**, across 84 summaries. Log:
`C:/Users/bnkr/AppData/Local/Temp/xeno-paid-loop-final-regression-20260904.log`.
Skips remain explicitly unqualified by this run; earlier isolated DB qualification
is separate evidence. The final changes affect only the test harness/tests/docs;
the TypeScript check passed earlier in this continuation.

A real confirmed-mode child with synthetic credentials and loopback port 1
successfully loaded the actual backend modules and exited 1 at ownership preflight,
with a sanitized failure receipt, zero provider resources and no stderr. The
offline plan exits 0 with UNEXECUTED. No confirmed provider transaction ran.
Scoped `git diff --check` passed (line-ending warnings only). No new production
build or deployment is claimed for these script-only changes.
