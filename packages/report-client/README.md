# XENO report client

One framework-free report compose and submission contract. No runtime dependencies.
Text redaction bundles the generated canonical ACP text policy distribution.
`node scripts/sync-report-redaction.mjs` refreshes it from agent-interface and records
its source SHA-256. Normal builds need no sibling checkout.

Collect optional context first, then call `compose()` to create the immutable reviewed
payload. `serializeReport(payload)` is the exact preview and POST body. Context omitted
from the draft is not collected or sent by compose/submit. Attachments are unavailable
in `xeno.report/1`. Schema `xeno.report/2` supports up to three reviewed image/video
attachments (8 MiB each, 12 MiB total), with type, byte count and SHA-256 validation.
Cookie transport is same-origin only, carries CSRF and binds the reviewed actor.

Persist `newReportSubmissionId()` alongside the reviewed payload before calling
`submit(payload, {submissionId})`. A lost response throws `ReportSubmissionUncertain`
with that ID. Recover it or retry the same payload and ID; `not_observed` is not a
terminal failure. No automatic POST retries or token forwarding across redirects.

Until npm publication, consume a qualified packed tarball under the app's `vendor/`
directory, per XENO REPORT spec. Publication remains the exit condition for that stand-in.
