# Platform local continuation — 2026-09-08

Scope: local source/candidate qualification on `9278420` plus preserved worktree
changes. No production deployment, provider writes, real charge, outbound email,
signup reopening, account reset, or authenticated customer mutation.

## Repairs

- Public health: removed the configured backup path and arbitrary backup/secretbox
  exception serialization from public responses. Fixed reason codes retain alarm
  states. Seventeen real HTTP fixture checks pass. All fifteen initial checks
  failed before the three-line production repair; independent review added R2
  status aggregation and repeated-request cache checks.
- Replaced the three native account dialog sites (project rename, archive,
  session revoke) with a shared Elements business composition. It validates
  names and exact receipts, prevents same-tick duplicate submissions, retains
  errors, and disables dismissal during requests. Workspace A→B→A and same-workspace
  project changes invalidate late completions. Confirmed archive/revoke retries
  repeat read-back rather than the destructive request.
- Current-session revocation no longer attempts to read inventory using the
  revoked session. Exact receipt leads to logout; an uncertain response offers
  explicit sign-in recovery without claiming confirmed revocation.
- Shared Modal gained additive `dismissDisabled`; `useDialog` contains initial
  Shift+Tab and disabled-control focus. Rendered testing exposed unresolved
  construction-color aliases at root; explicit construction scopes now resolve
  unchanged aliases where the palette exists. No color/geometry tokens changed.

Shared source is committed locally as `8fa822eb83599aa466dc3e95335c6cb64fa118de`
on `codex/platform-modal-dismissal-20260908`, based on Elements main. It is not
pushed, merged or published. The original contributor worktree was not changed.
Platform's existing bundled Modal/useDialog files carry the same candidate;
its renamed Industrial stylesheet has the equivalent selector correction.

## Fresh evidence

- TypeScript and final production build pass; 495 emitted files passed the Chat
  fixture boundary; 298 product pages prerendered with sitemap still disabled.
  Build log: `C:/Users/bnkr/AppData/Local/Temp/xeno-platform-build-20260908-final.log`.
  Entry module `index-DAx2WSJc.js` is 2,946,937 bytes (filesystem measurement);
  no interaction-latency or complete performance verdict follows from its size.
- Eleven account-dialog DOM flow tests plus seventeen health HTTP tests are in
  the default chain. Shared renderer: 324 tests and package typecheck pass.
- Platform fixture receipt:
  `C:/Users/bnkr/AppData/Local/Temp/xeno-launch-evidence-q3x5IG/report.json`.
  All 49 versioned migrations and startup replay passed, 25 workspace/project DB
  tests, 60 payment/signed-local-HTTP checks, 100k synthetic-vector recall@12 1.0,
  p95 90.09ms over 16 measured queries. Payment restore: 26 tables/94 rows/eight
  ledger chains; platform restore: 204 tables/200,233 rows.
- Backend fixture receipt:
  `C:/Users/bnkr/AppData/Local/Temp/xeno-launch-evidence-lKaWV7/report.json`.
  All thirteen selected backend suites passed, including ledger, authorization,
  OIDC, erasure, recovery, API keys and browser-session lifecycle.
- Both fixture runs reported clean cleanup; exact container IDs and scratch
  directories were independently confirmed absent. Existing account data and
  shared containers were not cleanup targets.
- Browser: real shared dialog component rendered at desktop and 390×844 in
  dark/light. Enter submitted, every pending control disabled, Tab/Shift+Tab
  stayed within the dialog, and completion restored opener focus. These were
  explicitly synthetic business callbacks, not account writes. Theme events
  were tab-local and did not save preferences. Temporary fixture source was
  removed; viewport override reset.
- Existing local preview started via `local-preview.mjs start`, not recovery or
  reset. Direct/proxied readiness passed. The browser remains at login awaiting
  user sign-in, so authenticated caller/browser qualification is not claimed.

Final default regression exited 0: **1,494 tests, 1,472 passed, 22 skipped,
zero failed/cancelled/TODO**. Log:
`C:/Users/bnkr/AppData/Local/Temp/xeno-platform-regression-20260908-complete.log`.
The earlier dialog run caught a stale source-count assertion in the foundation
test after the guard refactor. It now checks the stronger workspace/selection
generation guard, alongside actual DOM race tests; no behavior check was waived.

## Reconciled remaining work

The September 4 [sandbox lifecycle evidence](2026-09-04-stripe-hosted-lifecycle.md)
already proves hosted sandbox purchases, renewal, refunds, isolated public signed
ingress/recovery/duplicate/stale events, and manual receipt inbox delivery. Those
are not wholly untested. They do not establish live-account setup, deployed ingress,
automatic live receipts, delayed settlement or signed-in relogin entitlements.

Still open: actual email/Google/new-account journeys; canonical cross-product
execution permissions; remaining Elements adoption and full route/theme/a11y
matrix; interaction performance and real embedding quality; production-shaped
migration/restore and rollback; deployed monitoring/alert ownership; commercial,
tax and support confirmation; compliance rights/notices; clean reviewed release
and approved deployment. The earlier compliance inventory recorded 31 legacy
asset findings and 18 missing notice texts; this turn did not re-audit or clear them.

The Agent Interface contract, workspace host and SQLite authority files still
have uncommitted changes as freshly checked on September 8. Their ownership must
be coordinated before the cross-product permission work edits those interfaces.
No requirement was removed to claim a launch pass.
