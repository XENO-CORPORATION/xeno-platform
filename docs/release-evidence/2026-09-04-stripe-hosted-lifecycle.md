# Stripe sandbox hosted and lifecycle qualification

## Scope

Dedicated XENOSYSTEM Platform Qualification sandbox `acct_1UBwYiLLJZjl9ISl`.
Canonical billing/consent/entitlement services and migrations, disposable marked
loopback PostgreSQL, actual signed Stripe CLI deliveries. SDK API version
2025-02-24.acacia; CLI event version 2026-08-26.dahlia. No live charges, production
deployment or preview restart. The initial payment runs did not change merchant
settings or send real email; the sandbox-only receipt follow-up below did both.

| Run | Actual provider outcome | Delivered events |
| --- | --- | --- |
| 817e4c4be1efab81555b9ff2843833e7 | Hosted subscription Checkout paid with consent; exact subscription opened access; EUR24 full refund; cancellation closed access | 7 accepted, 1 unsigned probe rejected, 0 failed |
| f87fde0cb32d6e82b8f8fd11ae96b736 | New test clock/customer; next EUR24 cycle invoice paid; exact invoice events reconciled; DB period extended; cancellation closed access | 7 accepted, 1 unsigned probe rejected, 0 failed |
| 4b742ab50858c53472e379cb640fe634 | Hosted EUR10 credit pack; exactly 1,000 credits granted; EUR4 partial refund leaves 600; EUR6 remainder leaves zero | 9 accepted, 1 unsigned probe rejected, 0 failed |

All three runs verified owned customer cleanup, stopped CLI listeners, and stopped
their owned DB containers while retaining SQL audit volumes. Renewal additionally
verified owned test-clock deletion. Historical sandbox payment/refund records are
retained in Stripe, not erased. No pre-existing provider object was modified.

Local evidence receipts:

- `C:/Users/bnkr/AppData/Local/Temp/xeno-delivered-loop-3Vfybk/report.json`
- `C:/Users/bnkr/AppData/Local/Temp/xeno-delivered-loop-3zArC1/report.json`
- `C:/Users/bnkr/AppData/Local/Temp/xeno-delivered-loop-oF0NsV/report.json`

## Guards added

- Hosted callback success is never proof by itself: independently retrieve exact
  paid session/customer/subscription and consent; bind DB plan to that subscription.
- Refund only a verified test charge belonging to the exact customer's paid invoice
  or payment intent; verify provider status, amount and cumulative refunded amount.
- Renewal requires a NEW paid cycle invoice and successfully reconciled exact
  invoice event, not just a subscription.updated event or a higher DB timestamp.
- New clock/customer only, exact run-name ownership, recovery after lost create
  responses, refuse clock deletion if customer cleanup remains unresolved.
- Credit grants/refunds assert exact charge mapping, single grant journal entry,
  ledger balance, cumulative reversal, and distinct per-refund delivered event IDs.
- Receipts store safe IDs/types/result flags only, not provider payloads or secrets.

## Verification

Full `npm test` before the final credit-pack addition: 1,359 tests, 1,337 passed,
22 skipped, zero failed. Log: `C:/Users/bnkr/AppData/Local/Temp/xeno-payment-full-regression-20260904.log`.
Final focused billing gate: 127 passed, zero failures/skips. Syntax and scoped
whitespace checks passed.

Final full `npm test` after all three qualification slices: **1,361 tests,
1,339 passed, 22 skipped, zero failed**, exit code 0. Skipped tests are not counted
as qualified. Log:
`C:/Users/bnkr/AppData/Local/Temp/xeno-payment-final-regression-20260904.log`.

## Public HTTPS ingress and recovery follow-up

Two subsequent runs used an owned temporary public HTTPS endpoint registered in
the same dedicated sandbox, rather than CLI forwarding. These validate the
canonical billing handlers behind the isolated receiver, not the deployed
`xenostudio.ai` webhook route.

| Run | Measured result | Delivery counters |
| --- | --- | --- |
| ec5c9490d938ce2a0ca0e61a8bed2363 | Public ingress rejected unsigned local/remote probes; signed activation opened exact subscription access and cancellation closed it | 4 accepted, 2 unsigned probes rejected, 0 failures |
| 186e8874a842fd69a5e7ff38cc085ffe | Valid signed activation/invoice events deliberately received HTTP 503; no access granted; Stripe redelivery restored exact plan; duplicate left plan/ledger unchanged; stale created event after cancellation kept access closed | 4 accepted, 3 intentional outage rejections plus 2 unsigned probe rejections, 0 handler failures |

Recovery retrieved and ownership-verified the exact event
`evt_1UBxmjLLJZjl9ISlHavcXKSX` for subscription
`sub_1UBxmhLLJZjl9ISlUxsYDBNn`. Its three successful reconciliations correspond to
recovery, duplicate-active, and stale-after-cancel checks. Provider resend command
success alone was insufficient: every check required a new reconciled receipt
and independently read database/entitlement state. This is manual provider
redelivery proof, not measurement of Stripe's automatic retry schedule.

Both runs verified owned customer deletion, endpoint removal, tunnel shutdown,
and owned database shutdown with audit volumes retained. No shared preview or
existing customer was changed. Safe reports:

- `C:/Users/bnkr/AppData/Local/Temp/xeno-delivered-loop-AAfBM9/report.json`
- `C:/Users/bnkr/AppData/Local/Temp/xeno-delivered-loop-2eLpwk/report.json`

Harness hardening: receiver draining and PostgreSQL pool close now have bounded
deadlines, so a hung handler produces a failure and still reaches owned-resource
cleanup. Focused billing gate: **133 passed, zero failures/skips**.

Final full regression after recovery changes: `npm test` exit 0, **1,367 tests,
1,345 passed, 22 skipped, zero failures/cancellations/TODOs**. Log:
`C:/Users/bnkr/AppData/Local/Temp/xeno-payment-recovery-regression-20260904.log`.
No production build/deployment is claimed for these harness-only changes.

## Sandbox receipt settings and actual inbox delivery

On 2026-09-04, enabled **Successful payments** and **Refunds** under Customer
emails in sandbox `acct_1UBwYiLLJZjl9ISl`. Both switches were initially off and
were verified on after reload. No live-account setting was changed.

Sent exactly one manual test receipt for each of two existing owned synthetic
payments. Stripe restricted the recipient to the configured sandbox owner/support
mailbox; the dialog required account activation to send to other addresses. Used
that already accessible mailbox for this bounded check, without changing customer
email addresses, activating the account, or provisioning a new mailbox.

| Kind | Bound provider record | Stripe send history | Actual Gmail arrival (Europe/Berlin) |
| --- | --- | --- | --- |
| Successful payment | `pi_3UBxmhLLJZjl9ISl1MaeuySp`, invoice `FBVWYPWL-0008` | Payment, 4 Sept 14:48 (dashboard display) | 4 Sept 16:49; receipt `2308-6390`; EUR24 paid; Visa 4242; XENO Everything (`pro_monthly`) |
| Final partial refund | `pi_3UBxTxLLJZjl9ISl1cdNBJWo`, invoice `FBVWYPWL-0006` | Refund, 4 Sept 14:45 (dashboard display) | 4 Sept 16:45; receipt `3457-4147`; EUR6 refunded; Visa 4242; original EUR10 payment and cumulative EUR10 refunded |

Both subjects were explicitly prefixed `[Sandbox]`. Sender domain was
`stripe.com`, with the exact sandbox account in its sender identity. Read the
matching delivered messages, not just a send-success notification. Gmail exposed
the matching invoice PDF attachments; the refund also had a refund PDF attachment.
Attachments were not downloaded or independently validated. No new charge or
refund was created for this receipt check.

This qualifies manual sandbox payment/refund receipt delivery to the existing
configured mailbox. It does **not** prove automatic live delivery, delivery to
arbitrary customer inboxes, production branding/custom email domain, or a dedicated
QA inbox. The latter remains the intended long-term test destination, not a
provisioned resource. Keep Stripe as the receipt sender; do not add a competing
XENO payment-email sender. Customer-specific billing emails and live configuration
must be checked at the live boundary before launch.

## Not qualified by these runs

- Delayed-settlement provider journey and automatic retry timing.
- Automatic live receipt delivery, dedicated QA inbox, production receipt branding,
  and signed-in browser refresh/relogin entitlement. Manual sandbox inbox delivery
  passed as recorded above.
- Deployed production webhook ingress: temporary isolated public ingress passed,
  but does not qualify the deployed application boundary.
- Live XENOSYSTEM catalog/webhook/portal activation, tax/business validation and
  real-card merchant acceptance. Shared deployed backend remains a different test
  account; swapping keys without reconciling mappings is not safe.
- Full-platform UI/accessibility/performance, production rollback/restore,
  monitoring and release acceptance outside this payment slice.

Therefore these are measured sandbox payment gates, not a public-launch verdict.
