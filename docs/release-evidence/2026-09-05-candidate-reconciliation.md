# Platform candidate reconciliation — 2026-09-05

Branch: `codex/platform-release-candidate-20260905`.
Worktree: `X:/code/xeno-corporation/xeno-platform/.worktrees/platform-release-candidate-20260905`.
Incoming main: `26dff7c612fea882109113d8dc0d4222ff537998`.
Original work: `codex/full-web-context-platform` at `9278420998c6d0d51d43fa3aa5ebfb5472679e9f` plus WIP.

This is a local review candidate, not public-release approval. No push, deployment,
real payment, signup reopening, forced revocation or account reset was performed.

## Reconciliation and preservation

- Reconciled 11 upstream commits without replacing the original preview/worktree.
- Transferred the tracked changes and 112 selected untracked source/evidence files
  into a separate worktree. Excluded generated audit caches and DOM-test bundles.
- Preserved all 60 staged privacy removals (33 runtime uploads and 27 recovery files)
  in the candidate index. The original files remain available; no original user data
  was deleted. Snapshot preparation verified the original HEAD and index hash unchanged.
- Resolved package manifests by retaining incoming dependency versions and both sets
  of test commands. Restored license fields only when version/URL/integrity matched.
- Retained main's Tiptap 3, Express 5 and product-name changes and deployment cleanup.
- Fixed Tiptap 3's controlled video-prompt update options. A DOM test proves external
  values render without echoing through onChange.
- Normalized CRLF when the deployment-order test reads source; ancestry and exact-
  commit deployment enforcement were not weakened.
- Found and repaired four Express 4 route patterns incompatible with Express 5:
  browser catch-all, forum vote/flag constraints and optional download versions.
  A source-wide literal-path grammar gate and real Express routing tests preserve
  wildcard captures, named targets, rejected target types and optional versions.

## Dependency and notice work

- Authenticated source lookup verified `xeno-ai@0.1.1` as the private XENO SDK at
  the published commit. Additional first-party identity is pinned to archive SRI,
  version, source repository and manifest hashes; it is not contributor-rights signoff.
- MediaPipe, TensorFlow WebGL and ONNX now retain original copyright/license headers
  plus complete referenced license text. ONNX web includes both MIT and Apache-2.0
  notices; its top-level MIT label alone omitted bundled Apache-licensed code.
- `format` retains its original 2010-2013 source header, README attribution and a
  dated snapshot of the publisher MIT license explicitly linked by that source.
  Current website dates were not substituted for original copyright ranges.
- Removed unused `html-to-docx` from both dependency graphs. The existing export
  route uses docx and Cheerio and was preserved. An actual-source-handler HTTP test
  checks a real DOCX ZIP with headings, bold text, lists and a table, script omission,
  and the missing-input response. It isolates unrelated DB/queue startup and is not
  a substitute for authentication or complete router-mount qualification.
- Each graph lost 40 unused package entries; common package versions, URLs and
  integrity values stayed unchanged by that removal.
- Current notice collection: 957 records, 947 collected, two first-party entries,
  **eight unresolved texts**. Output stays a review candidate, not final notices.

## Verification recorded before freezing

Full regression, TypeScript and production build passed after upstream reconciliation.
The live Tiptap DOM check and real DOCX converter check passed. Both dependency audits
reported zero known vulnerabilities. Thirteen disposable-PostgreSQL backend suites
passed at `C:/Users/bnkr/AppData/Local/Temp/xeno-launch-evidence-ysE1oU/report.json`.
That receipt predates the final commit; fresh immutable-candidate qualification and
the compliance gate must be bound to the final candidate revision.

One earlier Vite-based DOCX test harness stayed alive after its assertions. It was
terminated and excluded from success evidence. Its replacement exercises the actual
handler and real backend dependencies without unrelated router startup and exits 0.
Install scripts were disabled during locked dependency installation; these results
do not independently qualify every optional native dependency or hosted provider.

## Still open

- 31 asset origins/rights: nine identity/icons and 22 media files. Existing logos
  remain unchanged. Embedded content credentials in eight old PNGs are not validated.
- Eight missing texts and the actual-grant conflict for highlightjs-vue: the installed
  archive says CC0 while a later repository license says BSD-3-Clause. No favorable
  grant was silently selected.
- Contributor rights and existing provenance/copyleft review groups. Questions and
  current file hashes are in `compliance/rights-review-packet.json`, without signoff.
- Final artifact-derived notices, fresh audit, main merge/release approval and
  hosted auth/payment/generation, production restore/monitoring and business gates.

Continue from this candidate worktree for reconciliation. The original worktree is
preserved for the existing localhost preview; do not confuse its older dependency
graph or dirty state with this review candidate.
