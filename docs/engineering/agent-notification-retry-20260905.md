# Agent notification receiver backoff — 2026-09-05

This is a shared queue repair toward UI04 channel delivery, not completion of
email/Slack/Discord adapters, digests or installed delivery qualification.

## Defect and implementation

`safeRequest` discarded receiver scheduling headers, and `WebhookDeliveryWorker`
always used local exponential backoff. A rate-limited receiver could therefore
be called again before its requested retry time.

The bounded shared transport now returns only the `Retry-After` field in addition
to its existing status/body projection. It does not expose cookies or arbitrary
response headers. The existing worker computes the greater of its exponential
backoff and the receiver's delay, then uses the existing fenced PostgreSQL
settlement to persist `next_retry_at`. No second queue or process-only timer was
introduced. Delay-seconds and HTTP dates are supported; malformed values use the
existing fallback. Values exceeding the queue's signed-int millisecond range
fail automatic retry explicitly (`delivery_retry_after_out_of_range`) instead
of wrapping or retrying earlier than requested. Delivery control remains manual
for terminal failure; a successful HTTP reply is not proof of human consumption.

Reference: [RFC 9110 Retry-After](https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after).

## Executed evidence

1. An owned, disposable PostgreSQL 17 container bound only to loopback ran:
   `node --test scripts/webhook-retry-policy.test.mjs scripts/webhook-delivery.test.mjs scripts/workspace-notifications.test.mjs`
   with `NOTIFICATION_TEST_DATABASE_URL` set only for that child invocation.
   **27 tests passed, zero skipped.** The existing controlled-receiver/killed-worker
   suite verifies the persisted 120-second delay and that a new worker cannot
   claim it before expiry. Existing workspace grants, cancellation, generation,
   retry, secret-redaction and lease fencing tests remain green.
2. A subsequent transport-projection test was added. The focused policy file
   then passed **4/4** tests, covering safe header projection, seconds/dates,
   malformed/excessive values and worker settlement arguments. This cohort
   overlaps item 1; do not add the two totals as separate coverage.
3. JavaScript syntax and diff checks passed. Zero owned proof schemas remained
   before the container was removed; its exact label and identity were checked.

The test receiver and transport responses were controlled fixtures; no real
notification destination was contacted. No provider keys, production data,
publishing, deployment, commit, global installation or instruction-file edit was
performed. The unrelated mentoring AGENTS.md remains untouched as directed.

## Remaining UI04 work

- Typed channel destinations and secret custody across Platform, Account SDK,
  host and UI, with compatible rollout behavior.
- Slack/Discord payload and acknowledgement adapters plus real email delivery
  through the existing provider transport.
- Durable digest-window aggregation and coordinated retention.
- Approved configured destinations and installed end-to-end evidence.

Official adapter research:
[Slack incoming webhooks](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks),
[Slack text escaping](https://docs.slack.dev/messaging/formatting-message-text/),
[Discord webhook execution](https://docs.discord.com/developers/resources/webhook).
No receiver adapter is advertised as implemented by this repair.

## Subsequent implemented receiver slice — same date

`agentWebhookFormat.js` is now called by the real workspace delivery worker.
Approved `hooks.slack.com/services/...` and `discord.com/api/webhooks/...` URLs
entered through the existing Webhook destination workflow get receiver-specific
metadata formatting. This is not a new dedicated channel-selector contract.
Generic and legacy/global webhooks retain their existing envelope/signature.

- Slack gets plain-text blocks with link/media unfurling disabled and requires
  HTTP 200 with `ok` acknowledgement.
- Discord gets metadata content with `allowed_mentions.parse=[]`, forces
  `wait=true`, and requires the returned string message ID. A no-wait 204 is not
  reported as confirmed message delivery.
- Known receiver paths and routing overrides are validated during destination
  preparation and again before dispatch. Unsupported shapes fail before sending.
- Only approved metadata is projected; prompt/tool bodies, URLs and secrets are
  not copied into messages. DNS pinning, redirects, bounds, authorization,
  cancellation, destination generations and leases retain their existing owners.
- Missing receiver acknowledgement produces `delivery_ack_unconfirmed`, not a
  fabricated delivered state. Retries are at-least-once at the external receiver;
  Slack/Discord do not gain exactly-once behavior from our local receipt store.

The final combined local suite passed **34/34, zero skipped**, including real
PostgreSQL create/prepare, rule save, admission, worker dispatch, exact receiver
ACK and unconfirmed-ACK failure. Receiver HTTP responses were controlled test
transports; no real SaaS destination was contacted. The owned PostgreSQL fixture
was checked for zero remaining proof schemas and removed.

Still open: dedicated typed channel selection across UI/Account SDK, real email
adapter, digest aggregation/retention, configured-account GUI acceptance, approved
live receiver qualification, deployment and installed consumer proof. The new
code is unpublished; previous packaged artifacts do not contain it.

## First-class channel projection follow-up — 2026-09-05

Dedicated typed rule selection is now implemented through
`/api/workspaces/:id/notifications/v2` and `/v2/settings`. V2 projects approved
URL-derived Webhook/Slack/Discord identities and validates a rule's selected
channel against its destination. V1 retains its generic projection for older
consumers. New writes never fall back to a legacy route. Slack/Discord creation
does not offer an unused generic signing-secret copy.

The Account SDK and shared Interface selector consume this same projection; the
UI does not classify receiver URLs itself. The combined Platform suite passed
48 tests with real PostgreSQL and HTTP/DPoP, zero skipped. Current receiver tests
still use controlled transport responses, not real SaaS destinations. Email,
digest aggregation/retention, deployment and installed/live acceptance remain.
Interface evidence is in `2026-09-05-notification-channel-qualification.md` in the
canonical Interface candidate. No deployment or publication occurred.
