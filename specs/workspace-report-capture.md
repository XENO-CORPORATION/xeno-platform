# Workspace reporting and evidence capture — implementation contract

Objective: from any authenticated workspace area, Shift+R or Help → Report a
problem opens a report composer that detects its location, supports optional
screenshots, area crops and short silent recordings, previews exactly what is
submitted, and posts as the current user into the existing Forum report intake.

## Evidence and decisions

- KNOWN: `prototypes/xeno-workspace/platform-community.js` overrides `XA.report`
  with the live report/preflight calls. `app.js` owns the F1 shortcut and Help UI.
  `modals.js` exports `XD.openShell` with focus trapping and dirty-close handling.
- KNOWN: `forumRoutes.js`, `forumWrite.js` and `forumTickets.js` implement public
  Feedback reports, private tickets, dedup, staff review and notifications.
- KNOWN: `xeno-platform-report/packages/report-client` contains a clean committed
  shared client, redaction re-export and uncertain-submission handling. Reuse this
  client here; do not replace the current private-ticket service with its older
  branch's parallel implementation. The canonical redactor is
  `xeno-agent-interface/packages/host/src/acp/acpTextRedaction.ts`.
- KNOWN: the owner explicitly overrides R6 of `XENO REPORT - SPEC.md`: use
  Shift+R rather than F1/Ctrl+Alt+R. Never consume it in input/textarea/select,
  editable elements, editors, terminals, dialogs, repeated/composing events, or
  with Ctrl/Alt/Meta. Keep the permanent Help report action. Scope to workspace.
- Public remains the existing default, with an adjacent private choice and a
  clear audience/permanence sentence. No anonymous posting or shared API key.

## Frontend contract

- Workspace reuses XD's three-plate modal. Kind (bug/feature/feedback), title,
  description, optional reproduction steps, public/private, removable context,
  attachment previews, duplicate candidates, review and Send states. No loss of
  draft on API refusal. Disable changes during uncertain submission recovery.
- Context is minimal: route pathname WITHOUT query/hash, area/product if known,
  viewport, language, browser/OS, build stamp when available. No chat text, cookies,
  storage, network bodies or automatic full log collection. Redact text before
  preview and serialize that same frozen payload on Send. Changing anything
  invalidates the review. Preview identity is bound to the account that reviewed.
- Tab capture uses user-initiated getDisplayMedia, explicitly asks the person to
  choose this tab, excludes audio, hides the composer, and stops every stream
  track afterward. This captures the visible tab, not inaccessible browser chrome
  or a full scrolling-page screenshot. A native permission denial preserves draft.
- Area capture lets the person drag a rectangle over the captured page snapshot;
  crop with the actual frame-to-overlay scale. Escape cancels; no upload occurs.
- Recording uses MediaRecorder, visible stop/timer control, no microphone/audio,
  max 30 seconds and 8 MiB. Stop on browser share-stop and on teardown. Do not
  capture automatically on opening the modal. All evidence remains local until Send.
- Max 3 attachments, 12 MiB total, 8 MiB/file. PNG/JPEG/WebP screenshots and
  WebM/MP4 recordings only. Every attachment removable. Image text is not claimed
  to be automatically redacted; the user reviews exactly the selected pixels.
- Submission uses the shared client with a same-origin session/CSRF transport
  extension, retaining the existing bearer-token transport for desktop adopters.
  A signed-out session refuses before any submission request.
- The report remains available on embedded workspace app surfaces via an explicit
  parent message and source/origin verification, or a context-menu entry routed
  to the parent; no unauthenticated postMessage submission capability.
- The same framework-free report view can mount on other signed-in platform
  surfaces. Native dialog supplies focus trapping; three-plate chrome matches
  the workspace. The launcher excludes homepage/auth routes, and only fetches
  the session when opened. Workspace Help delegates to that same view.

## Backend contract

- Extend the existing POST /api/forum/report rather than add another intake.
  Accept legacy callers unchanged; reviewed schema `xeno.report/2` adds context
  and bounded evidence. Validate kinds, visibility, lengths, byte count, MIME
  allowlist, magic bytes and SHA-256 BEFORE any write. No HTML/SVG attachments.
- Store evidence in a dedicated bytea table linked to the resulting public post
  or private forum ticket in the SAME DB transaction as report creation. A failed
  request leaves neither reports nor attachments. Rate/budget bounds apply to
  both visibilities. Do not use arbitrary filesystem paths or public object URLs.
- GET report evidence is public only for a visible public Forum post, otherwise
  requires the ticket's existing reporter/staff/product-agent authorization. A
  forbidden attachment returns the same 404 as an unknown one. Content-type from
  validated bytes, nosniff, restrictive CSP, no-store for private material.
- Include stable evidence links in the report body and typed metadata in the
  receipt. Existing forum/ticket readers can open images/video through these
  links; add an inline view in workspace report/thread readers where needed.
- Idempotency-Key UUID plus canonical request hash and principal scopes a
  submission receipt. Identical retries return the same report; changed content
  with the same key returns 409. Lost replies can be recovered without new posts.
- MCP report submission calls the same service as REST and supports the same
  schema; evidence read has an equivalent scoped tool. Never impersonate a human.
- Migrations extend existing forum_tickets; no duplicate private-ticket system.

## Acceptance

1. In a real browser, Shift+R opens from multiple workspace routes, does not fire
   during typing/editing, and Help opens the same composer. Homepage unaffected.
2. Screenshot, scaled crop and recording yield previewable local evidence; denial,
   cancellation, browser share-stop and 30-second/size stops release tracks.
3. Planted bearer/key/home-path values in context and text do not leave the client.
   Query/hash excluded. Removed context/evidence absent from preview AND request.
4. Review payload equals submitted payload; edits/account changes invalidate it.
   Signed-out submit sends nothing. Network refusal keeps the draft/evidence.
5. Real Postgres proof: public report + evidence, private report + evidence,
   wrong-user read refusal, schema/size/type rejection, rollback, idempotent retry
   and duplicate join. Test publication does not silently expose private evidence.
6. Source/client tests and browser tests, server route/parity checks and production
   build pass. Mutate shortcut binding/redaction/visibility authorization/review
   check in isolated tests and observe failures before calling them qualified.
7. Frontend/backend deploy via existing reviewed-main release scripts, migrations
   before traffic; health and signed-out refusal verified. Never create public
   test reports on production as another user.

Ancillary owner requests: missing SuiteLoop on Pixel/Canvas/Motion/Sound is fixed
by PR #884 and deployed separately. Homepage “02 · The system” must be edge-to-edge,
with neighbouring content inset, rather than stripping every section's gutters.

## Independent review reconciliation

- Preserve the current forum_tickets service/table and its existing readers.
  Normalize reviewed intake receipts to top-level shortId/private while retaining
  the legacy ticket response for callers without a reviewed schema.
- Private evidence never changes audience when a ticket is published. It is not
  embedded into the ticket body copied by publishTicket; the private ticket view
  gets its evidence separately. Publication of evidence requires a new reviewed
  public report, not the existing Make public action.
- Use one checked-out transaction client through all report/post/ticket/evidence/
  receipt writes; never BEGIN on pool.query. Check both public post and thread
  visibility. Add a rate/storage budget for private intake too.
- Reviewed titles/body use the existing stricter 200/20000 limits. Add a 17 MiB
  report-specific JSON parser before the global 100 MB parser.
- Cookie transport sends the serialized reviewed bytes with the existing CSRF
  and surface headers. It refuses cross-origin cookie mode. Iframe messages are
  navigation-to-composer only and verified against the frame source and origin.
- Bundle the canonical agent-interface redactor as a generated, provenance-bound
  first-party distribution asset. Clean CI builds consume that distribution,
  rather than requiring an unchecked-out sibling repository or another redactor.

## Qualification — 2026-10-22

- One native dialog implementation serves workspace, React routes and authenticated
  static product pages; homepage and authentication pages are excluded. Workspace
  Help and the verified chat-frame bridge open it. Other platform pages expose a
  permanent Report a problem button. Text inputs, editable content, editors,
  terminals, dialogs, modifier chords, repeated and composing events keep their keys.
- Native capture is always explicit: screenshots, scaled area crops, silent
  30-second recording and file attachments. A denied or interrupted capture keeps
  the draft. Startup failure and share termination release every track.
- Review displays the redacted title, description, reproduction steps, selected
  context, audience and exact image/video evidence. Send freezes payload and UUID.
  Lost-response recovery keeps all mutation controls locked, including duplicate
  choices. Browser-level transport replays reuse identical bytes and UUID.
- Product agents require explicit `forum_report_product_grants` for private ticket
  text, queues and evidence. A matching display handle or inherited admin role
  grants no access. Existing grants must be provisioned explicitly by XENO staff;
  no permissions are inferred or seeded from usernames.
- Passed: shared client 11 tests, 35 contract/reachability checks, real Postgres
  evidence proof, 28 ticket checks, full Community browser flow, capture browser
  proof and 13 marketing checks across 46 documents. Production build passed.
- Independent falsification found and verified repairs for duplicate-choice races,
  inconsistent private authorization and capture startup cleanup.
