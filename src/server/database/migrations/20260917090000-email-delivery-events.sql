-- email_logs learns what happened AFTER the provider accepted the message.
--
-- WHY
-- ---
-- Dogfooding 2026-09-17 (F2/F3): the activation mail for a mailbox that does not
-- exist read `status = 'sent'` while Resend reported `last_event: bounced`. "Sent"
-- here has only ever meant "the provider accepted it"; no delivery event ever came
-- back, so a customer who mistyped their address saw "check your inbox" forever
-- and support saw "sent". The Resend message id was logged to stdout and never
-- stored, so a support case could not be traced to the provider either.
--
-- WHAT
-- ----
-- Two terminal states the provider can report and the CHECK did not allow:
-- `delivered` (accepted by the receiving server) and `complained` (marked as spam
-- by the recipient — never mail them again). `bounced` was allowed and never
-- written. `provider_id` gets an index because the webhook resolves rows by it.
-- `event_at` records when the provider saw the event, distinct from `sent_at`.

ALTER TABLE email_logs DROP CONSTRAINT IF EXISTS email_logs_status_check;
ALTER TABLE email_logs
  ADD CONSTRAINT email_logs_status_check
  CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'bounced', 'complained', 'skipped'));

ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS event_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_email_logs_provider_id ON email_logs(provider_id) WHERE provider_id IS NOT NULL;

COMMENT ON COLUMN email_logs.status IS
  'pending → sent (provider accepted) → delivered | bounced | complained (provider events, routes/emailWebhookRoutes.js). failed = provider refused; skipped = no provider configured.';
