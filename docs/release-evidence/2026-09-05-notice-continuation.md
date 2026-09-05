# Notice evidence and local preview continuation

Date: 2026-09-05. Branch `codex/full-web-context-platform`, HEAD
`9278420998c6d0d51d43fa3aa5ebfb5472679e9f`, dirty worktree.
No production deployment, provider payment or legal signoff.

## Verified changes

The collector previously returned immediately upon finding a named LICENSE or
NOTICE and omitted complete README grants. It now preserves both evidence classes.
This retains 17 previously omitted README source texts across package records;
it does not mean 17 previously unlicensed packages have been cleared.
Regression cases cover NOTICE plus grant, LICENSE plus grant, and rejection of
a badge/link alone. All 13 package/asset evidence tests passed. Scoped diff check
passed, with only Git line-ending notices.

Collection still reports 1,072 package records: 1,053 collected, one explicitly
first-party scope entry and 18 missing texts. The output remains an unapproved
candidate at `.compliance/notices/`, not a shipped final notice.

Read-only follow-up on those 18 records:

- Six lack an acceptable immutable published GitHub reference: MediaPipe vision,
  TensorFlow WebGL, boolbase, dingbat-to-unicode and both ONNX Runtime packages.
- Published-commit tree lookups returned 404 for guid-typescript,
  react-remove-scroll-bar and xeno-ai. This does not distinguish a private source
  repository from an unavailable commit or absent repository.
- Nine returned root listings without named license files: dlv, eastasianwidth,
  error, format, highlightjs-vue, html-to-vdom, split-ca,
  tiptap-extension-pagination and tr46. This is root-listing evidence, not proof
  that no other valid source of permission exists.
- Archived READMEs often contain only a license label or link. Those were not
  promoted to complete license text or used to invent a copyright holder.

## Scan and audit

Authorized SCANOSS delta run `20260905T054228Z` scanned 13 changed tracked files:
zero matches, zero uncovered files within its 1,499-file tracked inventory.
Pending untracked source is outside this coverage and still needs final-candidate
qualification. No scan policy, threshold, suppression or determination was changed.

First audit `20260905T054248Z` used SaaS/release mode and artifact `dist` but omitted
the previously applied first-party XENOSYSTEM scope. Its extra UNLICENSED finding
for `@xenosystem/web-context-client` is an invocation mismatch, not evidence of a
new third-party dependency. Prior evidence explicitly classified that package as
first-party. An undeclared contributor-owner-set review also remains visible;
Git authorship alone was not used to clear it.

Corrected audit: `20260905T055411Z`, completed **BLOCK**, 18 findings:
one BLOCK, 16 REVIEW and one FIX. ScanCode and Syft completed; the snippet cache
covers 1,499 files with zero matches; artifact diff found zero unexplained components.
ORT timed out as a corroborating non-gating layer and owned-container cleanup
exited 0. Untracked WIP is not covered by the tracked-file scan.

The earlier audit had 17 findings. The additional current REVIEW asks for the
undeclared contributor-owner set; it was not cleared by inventing an expected-author
list from Git metadata. XENOSYSTEM first-party classification now matches the prior
audit. The repair retained evidence; it did not clear the asset or review findings.

All four audit actions remain: establish asset provenance before release; complete
artifact-derived notices; reconcile the dirty candidate without sweeping others'
work; and confirm author identities/rights. The engine labels the last three as
later work, but unresolved FIX/REVIEW findings still prevent a PASS release.

Reproducible invocation from this worktree:

```powershell
python X:/code/xeno-corporation/.agents/skills/xeno-product-check/scripts/check.py audit --repo . --profile saas --mode release --artifact dist --self-name xenostudio-server --self-scope '@xenosystem' --snippet-cache .compliance/snippet-cache.json --ort-budget 60
```

ORT is bounded to 60 seconds as a corroborating, non-gating layer. The first run's
owned-container cleanup exited 0. ScanCode and Syft completed and found no unexplained
artifact components. A dirty tree and missing notices/provenance do not permit release.

## Local runtime

The previous preview was no longer responding. `node scripts/local-preview.mjs start`
successfully started the saved, ownership-checked preview configuration without using
the recover/reset path. Direct backend readiness, frontend-proxied readiness and
the login page each returned HTTP 200. The launcher verified per-launch identity,
loopback ownership and frontend checkout identity. Outbound jobs/notifications and
paid services remain disabled. No authenticated browser journey is claimed.

## Remaining

Resolve package texts and applicability reviews, complete asset provenance and final
notices, reconcile contributor rights and WIP, then qualify the exact immutable release
candidate. Hosted payment/auth, genuine generation and demos, UI/performance, production
restore/monitoring, business signoff and approved live cutover remain in the launch
closure register. This continuation does not close those gates.
