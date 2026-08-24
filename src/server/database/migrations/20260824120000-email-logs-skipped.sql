-- email_logs: allow the status the code already writes.
--
-- `emailService.js` has a deliberate branch for "no provider is configured": the
-- message goes to the console and nowhere else, and the row is marked 'skipped'.
-- That branch exists because it used to fall through to 'sent', so email_logs
-- recorded a successful delivery for a message nobody received.
--
-- The semantic landed; the constraint did not. 'skipped' is not in the CHECK, so
-- that UPDATE throws, the outer catch marks the row 'failed', and the recorded
-- error is the constraint violation itself. The result is worse than a wrong
-- status: an operator asking "does email work?" is told about a database check
-- constraint instead of the actual answer, which is that no API key is set. The
-- caller's { skipped: true, reason: 'no_provider' } contract never fires either,
-- because the throw happens first.
--
-- 🔴 'skipped' is kept DISTINCT from 'failed' on purpose. Collapsing them would
-- make "how many emails failed" meaningless for any period where the provider
-- was simply switched off — a configuration state read as a delivery fault. The
-- whole point of this branch is that a no-op must not report as something else.
--
-- Safe to re-run and safe on live data: no existing row can hold a value the new
-- constraint forbids, because the new set is a superset of the old one.

ALTER TABLE email_logs DROP CONSTRAINT IF EXISTS email_logs_status_check;

ALTER TABLE email_logs
  ADD CONSTRAINT email_logs_status_check
  CHECK (status IN ('pending', 'sent', 'failed', 'bounced', 'skipped'));
