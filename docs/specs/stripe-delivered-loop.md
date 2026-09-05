# Stripe delivered service-loop qualification

Tier 2 implementation / authorized test-only external execution (user said do it
after the catalog pass and listed payment/webhook/cancellation qualification).
No live charges, deployment, real user records or real email. Test events/history
persist at Stripe; cleanup cancels owned subscriptions, expires sessions, deletes
synthetic customers and the owned temporary endpoint. Local DB retained stopped.

Independent falsification: P1 accepted. NODE_ENV alone does not prevent the dispute
handler sending email through inherited provider credentials. Before any service
imports, replace process environment with an OS-variable allowlist plus the explicit
sandbox key/pins and generated fixture configuration. No RESEND/SENDGRID/SMTP,
shared DB/Redis, NODE_OPTIONS, PG overrides or arbitrary operator environment.
Child processes receive the same scrubbed environment, with Docker user paths only
where needed. Test secret sentinels prove rejected environment variables absent.

## Evidence and scope

KNOWN: scripts/lib/paid-loop-proof.mjs::runProof implements consent, creation of
an actual Checkout session plus a separate test subscription, delivered plan and
entitlement checks, cancellation and owned resource cleanup. It does not complete
hosted Checkout. Its report correctly marks that and renewal/refund/receipts/relogin
unexercised. Preserve those open requirements.
KNOWN: billingService.js exports constructEvent and handleEvent. They are the real
signature and event-processing services used by billingRoutes.js::stripeWebhook.
KNOWN: startupSchema.js owns fresh startup migrations. platform-qualification.mjs
owns the pinned pgvector image parser and local Docker context guard.
KNOWN: dedicated sandbox acct_1UBwYiLLJZjl9ISl and ten prices verified by preceding
catalog tool. No endpoint/customer existed before this slice. Docker is running
locally and cloudflared is installed on the operator workstation.
UNKNOWN: external delivery and resulting entitlement transition; resolve this run.

## Contract / isolation

New runner offline by default, exact --confirm only. Reject non-test key or missing
exact sandbox account/mode pin before any resource creation. Fetch authenticated
account, inventory entire webhook list; refuse every enabled existing endpoint.
Validate existing canonical catalog via catalog provisioner (already qualified,
may only reconcile/create dedicated test catalog). No shared DB credentials used.

Create random 32-hex run ID and owned Docker container from pinned local image,
loopback random port, random password passed by environment (never command args).
Assert local Docker socket/context and full container ID/name/run label before
start/stop. Create a fresh xeno_paid_loop_<run> DB and matching ownership comment;
run canonical startup schema on it. Proof and receiver share this same pool target;
receiver rechecks marker before listening. No copying another database.

The only HTTP route exposed through ephemeral cloudflared is POST exactly
/api/billing/webhook. Bind Node to loopback port 0. All other paths/methods 404.
Raw body capped 1 MiB, no compressed body, max 8 in-flight handlers, finite 15s
request/header timeouts. Before configured, reject with 503. After configured use
real constructEvent, require event.livemode===false and reject connected-account
events, then real handleEvent. Reject invalid signature before any DB query; no
raw request/error/secret logged or returned. Counter-only status accounting.

Launch cloudflared using explicit --config pointing to an empty generated config
(no existing user config), --no-autoupdate and loopback target. Parse only generated
https://<slug>.trycloudflare.com hostname, never log provider output. Deadline 60s;
child failures close receiver/proof. Do not tunnel the normal backend or other routes.
Create endpoint with exact derived 11 handled events and pinned API version, plus
run metadata. Secret stays in process memory. Import billing only after setting
secret/catalog vars. Reuse SDK signature verification, not a second implementation.
Before fixture writes, remote invalid-signature request must return 400; subsequent
proof uses runProof with independent DB pool against the marked DB, 90s bounded
delivery waits. Failure counters and processing SQL failures make the run fail.

## Failure / cleanup / acceptance

Try/finally always removes only the newly created endpoint after verifying exact
ID/url/run metadata/test mode, and confirms deletion. Recover a lost create response
by exact URL/run metadata discovery. Stop tunnel and HTTP server; close pools, stop
only owned container, retain its volume for SQL audit (no DB deletion). Cleanup
failure means failure, not pass. Endpoint/tunnel unexpected exit means failure.
No API secret/raw exception in report; output sanitized stage + safe generated IDs,
counter totals, proof's explicit scope and remaining gates. A process crash may
leave an endpoint/container; report resources as soon as safely known for recovery.

Tests: test-only target guards; HTTP path/method/body/signature/live/account
refusals, successful signed fixture dispatch, handler failure, in-flight bound;
offline no-mutation plan; source pin/version contract. Existing runProof tests
already check owned cleanup and database/webhook target refusal. Then actual
sandbox run must show delivered activation and cancellation with access open/closed,
positive delivered successful requests, and successful endpoint/tunnel cleanup.
No result is called full payment readiness; other journey slices follow separately.

Lenses: money, security, network, concurrency, observability; no UI reskin, legal
advice or production release. Structural decision: temporary single-route receiver
calls the production services; this measures service delivery, not deployed routing.
Rollback rehearsed through injected cleanup checks in existing proof; new receiver
close tested locally before external creation. No restoration of production needed.

Execution refinement: require Cloudflare registered-connection signal as well as
generated URL; use HTTP/2 transport. Public DNS resolved the generated hostname
while the workstation returned HostNotFound. The unsigned probe resolves only
that generated host via Google DNS HTTPS, permits Cloudflare proxy IPv4 ranges,
preserves SNI/TLS validation and never changes system DNS. No probe credentials.

2026-09-04 refinement: subsequent generated hosts returned NXDOMAIN from both Google
and Cloudflare public resolvers while the tunnel was active. Do not claim every
failure is the Windows resolver. Retain the public-webhook qualification as open.
Explicit XENO_PAID_LOOP_TRANSPORT=stripe-cli is a separate service-loop transport:
installed Stripe CLI, empty generated config, only explicit sandbox key supplied
through STRIPE_API_KEY environment, exact 11 events, no --live or TLS bypass.
Wait for Ready and signing secret, keep secret in memory, use same signed receiver
and require positive accepted events plus delivered account transitions. No dashboard
endpoint created; all enabled dashboard endpoints remain forbidden. CLI's reported
API version recorded, not represented as the pinned public endpoint version. Close
owned child on every normal exit. Report Public webhook endpoint delivery untested.
This alternative does not qualify public ingress or hosted Checkout completion.

## Executed evidence, 2026-09-04

Run 8a29208f57420676649fcda5d568bd96: passed-delivered-service-loop-only through
Stripe CLI (reported event API version 2026-08-26.dahlia). Four signed events
accepted, one unsigned local probe rejected, zero handler failures. Real sandbox
Checkout session created and bound to exact consent; separate pm_card_visa test
subscription activated Pro plan/download entitlement, cancellation removed it.
Customer deletion, session expiry and subscription cancellation verified. CLI
stopped; fresh owned PostgreSQL container stopped and retained for audit.
Evidence: C:/Users/bnkr/AppData/Local/Temp/xeno-delivered-loop-4dM9vm/report.json.

Independent review P2 accepted: final verdict must wait for asynchronous receiver
handlers even after HTTP sockets close, then recheck failure counters; unexpected
transport exit is checked again before intentional shutdown. Regression verifies
idle barrier after a client disconnect. Dependency console errors also update the
persisted report, not only stdout. Stripe CLI receives a generated isolated profile
directory (Go requires USERPROFILE on Windows), never the operator's profile.

Open: hosted Checkout completion, renewal, delayed payment, refund, receipt email,
browser relogin, deployed/public webhook routing and production launch. This result
is not a claim of full payment readiness. Cloudflare quick-tunnel attempts failed
before payment creation; endpoint cleanup and owned container stop were verified.
